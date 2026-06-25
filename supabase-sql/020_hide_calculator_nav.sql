alter table public.profiles
add column if not exists hide_calculator_nav boolean not null default false;

comment on column public.profiles.hide_calculator_nav is 'Скрывать ссылку на калькулятор в общей шапке пользователя.';
