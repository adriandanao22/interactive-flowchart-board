-- Run this once in the Supabase SQL editor.
--
-- One saved flowchart per user, keyed by their auth id. Row Level Security is
-- what keeps users out of each other's charts: the anon key is public, so
-- without these policies anyone could read the whole table.

create table if not exists public.flowcharts (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  doc        jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Share link token. Null means the chart is not shared; setting it publishes
-- the chart to anyone holding the value, and clearing it revokes every link
-- that was ever handed out.
alter table public.flowcharts add column if not exists share_id uuid unique;

create index if not exists flowcharts_share_id_idx
  on public.flowcharts (share_id) where share_id is not null;

alter table public.flowcharts enable row level security;

-- Drop first so the script can be re-run safely.
drop policy if exists "read own chart"   on public.flowcharts;
drop policy if exists "insert own chart" on public.flowcharts;
drop policy if exists "update own chart" on public.flowcharts;
drop policy if exists "delete own chart" on public.flowcharts;

create policy "read own chart"   on public.flowcharts
  for select using (auth.uid() = user_id);

create policy "insert own chart" on public.flowcharts
  for insert with check (auth.uid() = user_id);

create policy "update own chart" on public.flowcharts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own chart" on public.flowcharts
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
create or replace function public.shared_chart(token uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select doc from public.flowcharts where share_id = token;
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
