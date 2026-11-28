-- Apply after 077 and 079. Existing budget states and revisions are preserved.
begin;
drop policy if exists finance_owner on public.finance_budgets;
drop policy if exists finance_owner_boundary on public.finance_budgets;
drop policy if exists finance_self on public.finance_budgets;
drop policy if exists finance_self_boundary on public.finance_budgets;
create policy finance_self on public.finance_budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy finance_self_boundary on public.finance_budgets as restrictive for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Only the server can claim a push; the browser cannot choose a recipient.
create or replace function public.claim_budget_bill_reminder(p_user_id uuid)
returns table (notification_id bigint, reminder_day date)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_day date := timezone('Europe/Moscow', now())::date; v_id bigint;
begin
  if not exists (select 1 from public.profiles p where p.user_id=p_user_id) then return; end if;
  delete from public.budget_bill_push_days d where d.reminder_day < v_day - 35;
  insert into public.budget_bill_push_days(user_id,reminder_day) values(p_user_id,v_day) on conflict do nothing;
  update public.budget_bill_push_days d set claimed_at=now()
    where d.user_id=p_user_id and d.reminder_day=v_day and d.delivered_at is null
      and (d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')
    returning d.notification_id into v_id;
  if not found then return; end if;
  if v_id is null then
    insert into public.user_notifications(user_id,type,title,body,url,expires_at)
      values(p_user_id,'budget_bill_reminder','Ближайшие обязательные платежи',
        'Приближается срок обязательных платежей. Откройте «Мой бюджет», чтобы проверить список.',
        'budget.html',now()+interval '36 hours') returning id into v_id;
    update public.budget_bill_push_days d set notification_id=v_id where d.user_id=p_user_id and d.reminder_day=v_day;
  end if;
  return query select v_id,v_day;
end;
$$;
revoke all on function public.claim_budget_bill_reminder(uuid) from public, anon, authenticated;
grant execute on function public.claim_budget_bill_reminder(uuid) to service_role;
commit;
