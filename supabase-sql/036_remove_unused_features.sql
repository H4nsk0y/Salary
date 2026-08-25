begin;

-- These sections were retired in favor of the shift checklist and announcements.
delete from public.user_notifications
where type = 'department_task_assigned'
   or url like 'tasks.html%'
   or url like 'voting.html%'
   or url like 'chat.html%'
   or url like 'instructions.html%';

do $$
declare
  v_job_id bigint;
begin
  if to_regclass('cron.job') is not null
     and to_regprocedure('cron.unschedule(bigint)') is not null then
    for v_job_id in
      select jobid
      from cron.job
      where jobname = 'alvisa-cleanup-department-tasks'
    loop
      perform cron.unschedule(v_job_id);
    end loop;
  end if;
exception when insufficient_privilege then
  raise notice 'The obsolete task cleanup cron job could not be removed with the current role.';
end;
$$;

drop function if exists public.create_department_task(text, date, timestamptz, text, text, uuid[]);
drop function if exists public.list_my_department_tasks(text, integer);
drop function if exists public.delete_department_task(bigint);
drop function if exists public.cleanup_expired_department_tasks();
drop table if exists public.department_task_assignees;
drop table if exists public.department_tasks;

drop function if exists public.list_completed_staff_vote_comments(text, date);
drop function if exists public.submit_staff_vote(text, uuid, text);
drop function if exists public.get_staff_vote_periods();
drop function if exists public.list_staff_vote_candidates();
drop function if exists public.finalize_staff_vote_period(text, date, date);
drop table if exists public.staff_votes;
drop table if exists public.staff_vote_results;

drop table if exists public.department_messages;

drop function if exists public.submit_easter_runner_score(text, integer, integer);
drop function if exists public.list_easter_runner_leaderboard(text, integer);
drop table if exists public.easter_runner_scores;

commit;
