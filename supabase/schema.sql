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
