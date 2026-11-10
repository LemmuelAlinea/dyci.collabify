-- supabase/task-comment-scope.sql
-- Who may comment on a work project's task. A plain member reads every task in
-- the project but comments only on tasks they hold; a team lead also comments on
-- tasks somebody on their team holds. The project manager, coordinators, QA and
-- anyone with the manage_tasks grant comment on any task. Class boards keep their
-- rule. Writing a comment is the only thing this narrows: someone taken off a task
-- can still fix or remove what they already wrote.
--
-- Runs after walkthroughs.sql and before anon-lockdown.sql. It takes over
-- general_task_comments_insert from project-stakeholders.sql (first written in
-- general-tasks.sql), so re-running either of those means re-running this.
-- Idempotent. Suite: supabase/tests/task-comment-scope.test.sql

create or replace function public.general_can_comment_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.general_can_write(t.project_id)
     and (
       p.class_board_id is not null
       or coalesce(public.general_role_of(t.project_id, auth.uid()) in ('pm', 'coordinator', 'qa'), false)
       or public.general_can(t.project_id, 'manage_tasks')
       or public.is_general_task_assignee(t.id)
       or exists (
         select 1 from public.general_task_assignees a
          where a.task_id = t.id
            and public.general_leads_user(t.project_id, auth.uid(), a.user_id)
       )
     )
    from public.general_tasks t
    join public.general_projects p on p.id = t.project_id
   where t.id = p_task;
$$;

revoke all on function public.general_can_comment_task(uuid) from public;
grant execute on function public.general_can_comment_task(uuid) to authenticated;

drop policy if exists general_task_comments_insert on public.general_task_comments;
create policy general_task_comments_insert on public.general_task_comments
  for insert with check (
    author_id = auth.uid()
    and public.general_can_write(project_id)
    and coalesce(public.general_can_comment_task(task_id), false)
  );
