-- Compatible with the existing Finance table and its revision-based writes.
begin;
create table if not exists public.finance_budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (
    jsonb_typeof(state) = 'object' and state ?& array['daily', 'records']
    and jsonb_typeof(state->'daily') = 'number' and jsonb_typeof(state->'records') = 'array'
  ),
  revision integer not null default 0 check (revision >= 0)
);
alter table public.finance_budgets enable row level security;
revoke all on public.finance_budgets from public, anon, authenticated;
grant select, insert, update on public.finance_budgets to authenticated;
drop policy if exists finance_owner on public.finance_budgets;
create policy finance_owner on public.finance_budgets for all to authenticated
using ((select auth.uid()) = user_id and coalesce((select public.is_owner()), false))
with check ((select auth.uid()) = user_id and coalesce((select public.is_owner()), false));
drop policy if exists finance_owner_boundary on public.finance_budgets;
create policy finance_owner_boundary on public.finance_budgets as restrictive for all to authenticated
using ((select auth.uid()) = user_id and coalesce((select public.is_owner()), false))
with check ((select auth.uid()) = user_id and coalesce((select public.is_owner()), false));
commit;
