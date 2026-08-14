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
