-- What a task's history says when somebody edits it.
--
-- The trigger in supabase/general-tasks.sql records which fields changed, which
-- answers "was this touched" but not "what did it say before" — and that second
-- question is the whole reason a group keeps a history. A line reading
-- "changed the title" is no use to an adviser asking what the title used to be.
--
-- So the three short, checkable fields now carry their old and new values:
-- title, status and due date. Description is deliberately left out — it runs to
-- twenty thousand characters and belongs in a diff, not in a log line.
--
-- Redefines record_general_task_event, whose previous definition is in
-- supabase/general-tasks.sql.
--
-- Idempotent. Safe to re-run.

begin;

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
