-- When a task is meant to start.
--
-- A Gantt bar needs two ends and a task only had one. `due_at` says when the
-- work is wanted; `starts_at` says when it is meant to begin, and the two
-- together are what a timeline draws.
--
-- Nullable on purpose. Every task that exists today has no start, including all
-- ten a capstone preset creates, and the chart draws those as a marker on their
-- due day rather than refusing to draw at all.
--
-- Redefines record_general_task_event, whose previous definition is in
-- supabase/general-history.sql, and general_task_overview, whose previous
-- definition is in supabase/general-tasks.sql.
--
-- Idempotent. Safe to re-run.

begin;

alter table public.general_tasks
  add column if not exists starts_at timestamptz;

comment on column public.general_tasks.starts_at is
  'When the work is meant to begin. Null means nobody has said yet.';

do $$ begin
  alter table public.general_tasks
    add constraint general_tasks_starts_before_due check (
      starts_at is null or due_at is null or starts_at <= due_at
    );
exception when duplicate_object then null; end $$;

commit;

begin;

/*
 * The overview carries it too, appended last because `create or replace view`
 * can only add columns at the end. Body copied from supabase/general-tasks.sql;
 * keep the two in step.
 */
create or replace view public.general_task_overview
with (security_invoker = true) as
select t.id,
       t.project_id,
       t.team_id,
       t.title,
       t.description,
       t.status,
       t.due_at,
       t.weight,
       t.created_by,
       t.completed_at,
       t.created_at,
       t.updated_at,
       coalesce(
         (select array_agg(a.user_id order by a.assigned_at)
            from public.general_task_assignees a where a.task_id = t.id),
         '{}'::uuid[]
       ) as assignee_ids,
       (select count(*) from public.general_task_comments c where c.task_id = t.id)::int as comment_count,
       (select count(*) from public.general_task_files f where f.task_id = t.id)::int as file_count,
       (select coalesce(sum(l.minutes), 0) from public.general_task_logs l where l.task_id = t.id)::int
         as logged_minutes,
       t.starts_at
  from public.general_tasks t;

grant select on public.general_task_overview to authenticated;

commit;

begin;

/*
 * A start that moves is how a plan slips, so the history keeps the old one —
 * the same treatment the title, status, due date and points already get.
 */
create or replace function public.record_general_task_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed text[] := array[]::text[];
  detail  jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (new.id, new.project_id, auth.uid(), 'created', jsonb_build_object('title', new.title));
    return new;
  end if;

  detail := jsonb_build_object('status', new.status);

  if new.title is distinct from old.title then
    changed := array_append(changed, 'title');
    detail := detail || jsonb_build_object('title_from', old.title, 'title_to', new.title);
  end if;

  if new.description is distinct from old.description then
    changed := array_append(changed, 'description');
  end if;

  if new.status is distinct from old.status then
    changed := array_append(changed, 'status');
    detail := detail || jsonb_build_object('status_from', old.status);
  end if;

  if new.due_at is distinct from old.due_at then
    changed := array_append(changed, 'due_at');
    detail := detail || jsonb_build_object('due_from', old.due_at, 'due_to', new.due_at);
  end if;

  if new.starts_at is distinct from old.starts_at then
    changed := array_append(changed, 'starts_at');
    detail := detail || jsonb_build_object('starts_from', old.starts_at, 'starts_to', new.starts_at);
  end if;

  if new.team_id is distinct from old.team_id then
    changed := array_append(changed, 'team_id');
  end if;

  if new.weight is distinct from old.weight then
    changed := array_append(changed, 'weight');
    detail := detail || jsonb_build_object('weight_from', old.weight, 'weight_to', new.weight);
  end if;

  if array_length(changed, 1) > 0 then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (new.id, new.project_id, auth.uid(), 'updated',
            detail || jsonb_build_object('fields', to_jsonb(changed)));
  end if;

  return new;
end;
$$;

drop trigger if exists general_tasks_history on public.general_tasks;
create trigger general_tasks_history after insert or update on public.general_tasks
  for each row execute function public.record_general_task_event();

revoke all on function public.record_general_task_event() from public, anon;

commit;
