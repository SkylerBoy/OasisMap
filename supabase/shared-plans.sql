-- Shared plans: short links like ?plan=K7XQ2M instead of the long ?p=… one.
-- Run once in Supabase → SQL Editor (after schema.sql).

create table if not exists public.shared_plans (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  plan text not null check (length(plan) < 1000),
  expires date not null check (expires <= current_date + 10),
  created_at timestamptz not null default now()
);

alter table public.shared_plans enable row level security;

-- Phones may only add plans; nobody can list or read the table directly.
revoke all on public.shared_plans from anon, authenticated;
grant insert (code, plan, expires) on public.shared_plans to anon;
drop policy if exists "anyone can share a plan" on public.shared_plans;
create policy "anyone can share a plan" on public.shared_plans
  for insert to anon with check (true);

-- Reading: one plan at a time, only knowing its code, only while it is valid.
create or replace function public.get_plan(c text)
returns text
language sql
security definer
set search_path = public
as $$
  select plan from public.shared_plans where code = upper(c) and expires >= current_date;
$$;
revoke all on function public.get_plan(text) from public;
grant execute on function public.get_plan(text) to anon;

-- Expired plans are cleared whenever a new one is shared.
create or replace function public.clear_expired_plans()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.shared_plans where expires < current_date;
  return new;
end;
$$;
drop trigger if exists clear_expired on public.shared_plans;
create trigger clear_expired after insert on public.shared_plans
  for each statement execute function public.clear_expired_plans();
