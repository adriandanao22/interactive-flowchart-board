-- Run this in the Supabase SQL editor. It is written to be re-runnable, so
-- applying it again after an update is safe and is how you migrate.
--
-- Many flowcharts per user, one row each. Row Level Security is what keeps
-- them private: the publishable key is public, so without these policies
-- anyone could read the whole table.

create table if not exists public.flowcharts (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  name       text        not null default 'Untitled chart',
  doc        jsonb       not null,
  -- Share link token. Null means not shared; setting it publishes the chart to
  -- anyone holding the value, and clearing it revokes every link handed out.
  share_id   uuid        unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Migration from the one-chart-per-user layout.
--
-- The original table used user_id as its primary key, which is exactly what
-- stops a user having a second chart. `create table if not exists` above will
-- not have touched such a table, so move it across here: give every row its own
-- id, name it after the chart it holds, and hand the primary key over.
--
-- Guarded on the absence of `id`, so this runs once and is a no-op after that.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'flowcharts' and column_name = 'id'
  ) then
    alter table public.flowcharts add column id uuid not null default gen_random_uuid();
    alter table public.flowcharts add column name text not null default 'Untitled chart';
    alter table public.flowcharts add column created_at timestamptz not null default now();

    -- The chart already knows what it is called; keep that rather than
    -- leaving every migrated row as "Untitled chart".
    update public.flowcharts
       set name = coalesce(nullif(trim(doc ->> 'title'), ''), 'My chart');

    alter table public.flowcharts drop constraint flowcharts_pkey;
    alter table public.flowcharts add primary key (id);

    raise notice 'flowcharts: migrated to one row per chart';
  end if;
end $$;

-- Present on both paths: added by the create above, or missing on a table that
-- predates share links.
alter table public.flowcharts add column if not exists share_id uuid unique;

-- Listing a user's charts is the most common read, and share lookups go
-- through the token.
create index if not exists flowcharts_user_id_idx on public.flowcharts (user_id);
create index if not exists flowcharts_share_id_idx
  on public.flowcharts (share_id) where share_id is not null;

alter table public.flowcharts enable row level security;

-- Drop first so the script can be re-run safely.
drop policy if exists "read own charts"   on public.flowcharts;
drop policy if exists "insert own charts" on public.flowcharts;
drop policy if exists "update own charts" on public.flowcharts;
drop policy if exists "delete own charts" on public.flowcharts;
-- Singular names, from before there could be more than one.
drop policy if exists "read own chart"    on public.flowcharts;
drop policy if exists "insert own chart"  on public.flowcharts;
drop policy if exists "update own chart"  on public.flowcharts;
drop policy if exists "delete own chart"  on public.flowcharts;

create policy "read own charts"   on public.flowcharts
  for select using (auth.uid() = user_id);

create policy "insert own charts" on public.flowcharts
  for insert with check (auth.uid() = user_id);

create policy "update own charts" on public.flowcharts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own charts" on public.flowcharts
  for delete using (auth.uid() = user_id);

-- Reading a shared chart.
--
-- Note what is NOT here: there is no `for select using (share_id is not null)`
-- policy. That would look equivalent, but it would let anyone holding the
-- publishable key run `select * from flowcharts where share_id is not null`
-- and walk away with every shared chart in the project. A policy grants access
-- to a *set of rows*, and a share link is supposed to grant access to exactly
-- one.
--
-- So the table stays owner-only and this function is the single way in. It is
-- SECURITY DEFINER, meaning it runs with the definer's rights and bypasses RLS
-- — safe here only because it takes the token as an argument and can return
-- nothing else: no wildcard, no second row, no way to enumerate. A caller who
-- does not already know a token learns nothing, and guessing one means
-- guessing a v4 UUID.
--
-- `name` rides along so a shared board can say what it is called without
-- exposing anything else about the row or its owner.
drop function if exists public.shared_chart(uuid);

create or replace function public.shared_chart(token uuid)
returns table (name text, doc jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select f.name, f.doc from public.flowcharts f where f.share_id = token;
$$;

-- EXECUTE is granted to the public role by default, so narrow it deliberately.
revoke all on function public.shared_chart(uuid) from public;
grant execute on function public.shared_chart(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Comments on a shared chart.
--
-- Anyone holding a share link can post, without an account. That is the point
-- — a student should not have to sign up to ask why a diamond branches left —
-- but it does mean an unauthenticated stranger can write to this table, so the
-- protection has to live here rather than in the client.
--
-- Three things carry it:
--   1. Neither reading nor writing is possible without the share token. There
--      is no anon policy on this table at all; the only way in is the two
--      functions below, which take a token and resolve exactly one chart.
--   2. Length and rate caps inside the insert function, so a script holding a
--      real token still cannot fill the database.
--   3. `comments_enabled` on the chart, so the author can switch it off, and
--      revoking the share link stops new comments outright.
-- ---------------------------------------------------------------------------

alter table public.flowcharts
  add column if not exists comments_enabled boolean not null default true;

create table if not exists public.chart_comments (
  id         uuid        primary key default gen_random_uuid(),
  chart_id   uuid        not null references public.flowcharts (id) on delete cascade,
  -- Set only when the chart's own author posted, which is what lets a reply
  -- be marked as coming from them. Visitors have no account, so theirs is
  -- null — and the insert policy below is what makes that trustworthy.
  user_id    uuid        references auth.users (id) on delete set null,
  -- Which shape this is pinned to, and which chart of the document it lives
  -- in (null chart_key is the main chart). Both null is a comment on the
  -- whole thing.
  node_id    text,
  chart_key  text,
  author     text        not null,
  body       text        not null,
  created_at timestamptz not null default now(),

  constraint chart_comments_author_len  check (char_length(author) between 1 and 40),
  constraint chart_comments_body_len    check (char_length(body) between 1 and 2000),
  constraint chart_comments_node_len    check (node_id is null or char_length(node_id) <= 64),
  constraint chart_comments_key_len     check (chart_key is null or char_length(chart_key) <= 64)
);

-- For a table created before author comments existed.
alter table public.chart_comments
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists chart_comments_chart_idx
  on public.chart_comments (chart_id, created_at);

alter table public.chart_comments enable row level security;

-- The author's own access. Visitors get nothing here — they go through the
-- functions below, which is what makes holding the token a requirement.
drop policy if exists "read comments on own charts"   on public.chart_comments;
drop policy if exists "write comments on own charts"  on public.chart_comments;
drop policy if exists "delete comments on own charts" on public.chart_comments;

create policy "read comments on own charts" on public.chart_comments
  for select using (
    exists (
      select 1 from public.flowcharts f
      where f.id = chart_comments.chart_id and f.user_id = auth.uid()
    )
  );

-- The author writes directly rather than through a share token: they may be
-- replying to a question, or simply leaving themselves a note on a chart that
-- has never been shared.
--
-- Both halves of the check matter. `user_id = auth.uid()` stops a comment
-- being attributed to anyone else, and the `exists` stops it being attached to
-- a chart you do not own. Together they are what makes a non-null `user_id`
-- reliable proof that the chart's own author wrote it.
create policy "write comments on own charts" on public.chart_comments
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.flowcharts f
      where f.id = chart_comments.chart_id and f.user_id = auth.uid()
    )
  );

create policy "delete comments on own charts" on public.chart_comments
  for delete using (
    exists (
      select 1 from public.flowcharts f
      where f.id = chart_comments.chart_id and f.user_id = auth.uid()
    )
  );

-- Read the thread for a share token. Same shape of argument as
-- `shared_chart`: one token in, one chart's comments out, no way to enumerate.
--
-- `from_author` rather than the raw user_id: a visitor needs to know which
-- replies came from the person who made the chart, and nothing more. Handing
-- out the owner's account id would be a needless leak.
drop function if exists public.shared_comments(uuid);

create or replace function public.shared_comments(token uuid)
returns table (
  id uuid, node_id text, chart_key text, author text, body text,
  created_at timestamptz, from_author boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.node_id, c.chart_key, c.author, c.body, c.created_at,
         c.user_id is not null as from_author
    from public.chart_comments c
    join public.flowcharts f on f.id = c.chart_id
   where f.share_id = token
   order by c.created_at;
$$;

-- Post to the thread for a share token.
--
-- Written as a function rather than an insert policy for the same reason the
-- read is: a policy grants access to a set of rows, and this must grant
-- exactly one chart's worth to whoever proves they hold its link.
create or replace function public.add_shared_comment(
  token     uuid,
  in_author text,
  in_body   text,
  in_node   text default null,
  in_key    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target  uuid;
  enabled boolean;
  recent  integer;
  total   integer;
  new_id  uuid;
begin
  select f.id, f.comments_enabled into target, enabled
    from public.flowcharts f where f.share_id = token;

  if target is null then
    raise exception 'That share link is not valid.' using errcode = 'P0002';
  end if;
  if not enabled then
    raise exception 'Comments are turned off for this chart.' using errcode = 'P0001';
  end if;

  -- Caps, not authentication: a real token still cannot be used to flood.
  select count(*) into recent from public.chart_comments c
   where c.chart_id = target and c.created_at > now() - interval '1 minute';
  if recent >= 10 then
    raise exception 'Too many comments just now — wait a moment and try again.'
      using errcode = 'P0001';
  end if;

  select count(*) into total from public.chart_comments c where c.chart_id = target;
  if total >= 500 then
    raise exception 'This chart has reached its comment limit.' using errcode = 'P0001';
  end if;

  insert into public.chart_comments (chart_id, node_id, chart_key, author, body)
  values (target, nullif(in_node, ''), nullif(in_key, ''), btrim(in_author), btrim(in_body))
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.shared_comments(uuid) from public;
revoke all on function public.add_shared_comment(uuid, text, text, text, text) from public;
grant execute on function public.shared_comments(uuid) to anon, authenticated;
grant execute on function public.add_shared_comment(uuid, text, text, text, text) to anon, authenticated;

-- Keep updated_at honest even if a client forgets to set it.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists flowcharts_touch_updated_at on public.flowcharts;
create trigger flowcharts_touch_updated_at
  before update on public.flowcharts
  for each row execute function public.touch_updated_at();
