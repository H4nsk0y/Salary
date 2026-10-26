-- Personal estimated income-tax rate, stored as a fraction: 0.13 = 13%.
begin;
alter table public.profiles add column if not exists tax_rate numeric(7,6) not null default 0.13;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_tax_rate_range') then
    alter table public.profiles add constraint profiles_tax_rate_range check (tax_rate between 0 and 1);
  end if;
  if to_regprocedure('public._get_my_app_context_before_tax()') is null then
    alter function public.get_my_app_context() rename to _get_my_app_context_before_tax;
  end if;
end $$;
-- Keep all existing role/column restrictions and RLS boundaries intact.
grant insert(tax_rate), update(tax_rate) on public.profiles to authenticated;
revoke all on function public._get_my_app_context_before_tax() from public, anon, authenticated;

create or replace function public.get_my_app_context()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_context jsonb; v_rate numeric;
begin
  if auth.uid() is null then raise exception 'NO_SESSION'; end if;
  v_context := public._get_my_app_context_before_tax();
  select tax_rate into v_rate from public.profiles where user_id=auth.uid();
  if jsonb_typeof(v_context->'profile') = 'object' then
    v_context := jsonb_set(v_context,'{profile,tax_rate}',to_jsonb(coalesce(v_rate,0.13)),true);
  end if;
  return v_context;
end;
$$;
revoke all on function public.get_my_app_context() from public, anon;
grant execute on function public.get_my_app_context() to authenticated;
comment on column public.profiles.tax_rate is 'User-selected flat rate for estimates; not an automatic calculation of tax deductions or progressive tax brackets.';
commit;
