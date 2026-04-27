alter table public.profiles
add column if not exists branch text;

comment on column public.profiles.branch is 'Филиал сотрудника. Используется как заготовка для будущих правил нормы и аналитики.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_branch_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
    add constraint profiles_branch_check
    check (
      branch is null
      or branch in (
        'chateau_alvisa',
        'alvisa_whisky',
        'alvisa_beverage',
        'alvisa_whisky_distillery',
        'kin_wine_cognac_factory'
      )
    );
  end if;
end $$;

create index if not exists profiles_branch_idx
on public.profiles (branch);
