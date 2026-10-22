-- Oasis Wildlife map: anonymous visit times per point, to plan with real averages.
-- Run once in Supabase → SQL Editor. Then put the project URL and the "anon public"
-- key in public/data/config.json → "stats".

-- One row per stay at a point: which point and how many minutes. Nothing about the person.
create table if not exists public.visits (
  id bigint generated always as identity primary key,
  poi text not null check (poi ~ '^[a-z0-9-]{2,40}$'),
  minutes real not null check (minutes between 1 and 90),
  created_at timestamptz not null default now()
);

alter table public.visits enable row level security;

-- Explicit rights (works whether or not "expose new tables" is on):
-- the public key may only add visits, never read, change or delete them.
revoke all on public.visits from anon, authenticated;
grant insert (poi, minutes) on public.visits to anon;

-- Visitors' phones may only add rows (no reading, changing or deleting).
drop policy if exists "anyone can add a visit" on public.visits;
create policy "anyone can add a visit" on public.visits
  for insert to anon with check (true);

-- What the app reads: median minutes per point over the last 6 months,
-- only once there are enough visits for it to mean something.
create or replace view public.poi_times as
  select poi,
         round(percentile_cont(0.5) within group (order by minutes)::numeric, 1) as median,
         count(*) as n
  from public.visits
  where created_at > now() - interval '180 days'
  group by poi
  having count(*) >= 20;

revoke all on public.poi_times from anon, authenticated;
grant select on public.poi_times to anon;
