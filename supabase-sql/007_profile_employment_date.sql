alter table public.profiles
add column if not exists employment_date date;

comment on column public.profiles.employment_date is 'Дата трудоустройства сотрудника. Используется как заготовка для точного расчета нормы новичков.';
