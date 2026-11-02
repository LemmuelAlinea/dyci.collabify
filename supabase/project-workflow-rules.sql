-- supabase/project-workflow-rules.sql
--
-- A work project's workflow rules: "When {trigger}, then {action}", one of
-- each per rule, at most 20 per project, each on or off. This part holds the
-- rules table, who reads and writes it, the write-time checks, the
-- notification type and the history event kind; the rule runner comes after
-- it in this file.
--
-- general_workflow_rules, one row per rule:
--   trigger_kind     stage_entered (trigger_stage, a stage name)
--                    task_released
--                    task_overdue
--                    priority_raised (trigger_priority: high or urgent)
--   action_kind      notify (notify_to: team_lead, planners, qa, holders, or
--                            person with person_id)
--                    set_priority (action_priority: low, normal, high, urgent)
--                    assign (person_id)
--                    move_stage (action_stage, a stage name)
--   position         creation order, set on insert; never changed
--   last_skipped_at, last_skip_reason
--                    written only by the rule runner (or another write with no
--                    signed-in person). A signed-in person's value is dropped
--                    (kept as it was on an update, null on an insert), like
--                    guard_general_milestone_overdue. The runner marks its
--                    writes with the transaction-local setting
--                    collabify.workflow_rule_run = 'on'. A signed-in edit of
--                    what a rule does (its trigger, action, stage, priority or
--                    person) clears the last skip; turning it on or off or
--                    renaming it keeps it.
-- Check constraints make each kind's fields present and the others empty. A
-- rule's person is required by the guard instead of a constraint, so deleting
-- the person's account (on delete set null) never fails.
--
-- Reads: members of the project, and anyone who reads the project
-- (is_general_member or can_read_general_project). Writes:
-- general_can_manage_workflow(project), the project manager and active
-- coordinators of a live work project (not archived). Stakeholders, QA and
-- members read only.
--
-- The guard, general_workflow_rules_guard (before insert or update):
--   "Workflow rules are for work projects."      a class board (ahead of the
--                                                permission check, since RLS's
--                                                refusal would hide it)
--   (no message)                                 a signed-in person who may not
--                                                write rules: the guard returns
--                                                early, takes no lock, and RLS
--                                                refuses the write
--   the archived message                         an archived project, to its
--                                                project manager or a coordinator
--   "A project can have up to 20 rules."         a 21st rule
--   "A rule stays in its project."               project_id changed
--   "Choose a stage in this project."            a stage the project lacks
--                                                (matched case-insensitively,
--                                                saved as the project names it)
--   "Choose a stage that isn't the last one."    move_stage to the last stage
--   "Choose someone in this project."            no person, or a person to
--                                                notify who isn't a current
--                                                (active) member other than a
--                                                stakeholder (QA may be notified)
--   "That person can't be given tasks."          assign to QA, a stakeholder,
--                                                or anyone not a current member
-- The stage and person checks run on insert and when a signed-in edit
-- changes those fields (a signed-in person clearing person_id included), so a
-- rule whose stage or person has gone can still be turned off or renamed. The
-- runner reports those rules as skipped. A person or creator whose account is
-- deleted is cleared (on delete set null) and the rule stays: created_by is
-- kept on an update unless it goes to null, so nobody repoints it.
--
-- Notification type workflow_rule. History event kind rule_applied (added to
-- the general_task_events_kind check, last written by work-task-handoff.sql;
-- actor_id is nullable, so a rule's entry carries no person).
--
-- In realtime, replica identity full.
--
-- Class boards and class tables are untouched.
--
-- Run after project-notification-rules.sql, then anon-lockdown.sql. Re-running
-- work-task-handoff.sql or project-qa.sql (each rewrites
-- general_task_events_kind) means re-running this file afterwards, then
-- anon-lockdown.sql; otherwise rule_applied is refused.
--
-- Idempotent. Safe to re-run.

-- A new enum value must be committed before anything can use it.
begin;
do $$
begin
  alter type public.notification_type add value if not exists 'workflow_rule';
end $$;
commit;

begin;

-- ---------------------------------------------------------------- history

alter table public.general_task_events drop constraint if exists general_task_events_kind;
alter table public.general_task_events add constraint general_task_events_kind check
  (kind in ('created', 'updated', 'assigned', 'unassigned', 'qa_passed', 'qa_sent_back',
            'sent_to_coordinator', 'returned', 'sent_to_team', 'rerouted', 'rule_applied'));

-- ---------------------------------------------------------------- rules

create table if not exists public.general_workflow_rules (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.general_projects (id) on delete cascade,
  name             text not null default '',
  enabled          boolean not null default true,
  position         int not null,
  trigger_kind     text not null,
  trigger_stage    text,
  trigger_priority text,
  action_kind      text not null,
  notify_to        text,
  person_id        uuid references public.profiles (id) on delete set null,
  action_priority  text,
  action_stage     text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_skipped_at  timestamptz,
  last_skip_reason text
);

alter table public.general_workflow_rules
  drop constraint if exists general_workflow_rules_name,
  drop constraint if exists general_workflow_rules_trigger_kind,
  drop constraint if exists general_workflow_rules_trigger_priority,
  drop constraint if exists general_workflow_rules_action_kind,
  drop constraint if exists general_workflow_rules_notify_to,
  drop constraint if exists general_workflow_rules_action_priority,
  drop constraint if exists general_workflow_rules_trigger_fields,
  drop constraint if exists general_workflow_rules_action_fields;
alter table public.general_workflow_rules
  add constraint general_workflow_rules_name check (char_length(name) <= 80),
  add constraint general_workflow_rules_trigger_kind
    check (trigger_kind in ('stage_entered', 'task_released', 'task_overdue', 'priority_raised')),
  add constraint general_workflow_rules_trigger_priority
    check (trigger_priority in ('high', 'urgent')),
  add constraint general_workflow_rules_action_kind
    check (action_kind in ('notify', 'set_priority', 'assign', 'move_stage')),
  add constraint general_workflow_rules_notify_to
    check (notify_to in ('team_lead', 'planners', 'qa', 'holders', 'person')),
  add constraint general_workflow_rules_action_priority
    check (action_priority in ('low', 'normal', 'high', 'urgent')),
  add constraint general_workflow_rules_trigger_fields check (
    (trigger_kind = 'stage_entered') = (trigger_stage is not null)
    and (trigger_kind = 'priority_raised') = (trigger_priority is not null)),
  add constraint general_workflow_rules_action_fields check (
    (action_kind = 'notify') = (notify_to is not null)
    and (action_kind = 'set_priority') = (action_priority is not null)
    and (action_kind = 'move_stage') = (action_stage is not null)
    and (person_id is null or action_kind = 'assign' or coalesce(notify_to = 'person', false)));

create unique index if not exists general_workflow_rules_position
  on public.general_workflow_rules (project_id, position);
create index if not exists general_workflow_rules_person
  on public.general_workflow_rules (person_id) where person_id is not null;

-- ---------------------------------------------------------------- who writes

/**
 * The caller may add, change, turn off and delete the project's workflow
 * rules: its project manager or an active coordinator, on a work project
 * that isn't archived.
 */
create or replace function public.general_can_manage_workflow(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    exists (select 1 from public.general_projects gp
             where gp.id = p_project and gp.class_board_id is null and gp.archived_at is null)
    and coalesce(public.general_role_of(p_project, auth.uid())::text, '') in ('pm', 'coordinator'),
    false);
$$;

/**
 * A stage of the project by name, matched case-insensitively: its name as the
 * project spells it, its 0-based index and how many stages there are. No row
 * when the project has no such stage.
 */
create or replace function public.general_workflow_stage(p_project uuid, p_name text)
returns table (name text, idx int, n int)
language sql stable security definer set search_path = public as $$
  select s.name, (s.i - 1)::int, public.stage_count(gp.stages)
    from public.general_projects gp,
         unnest(coalesce(gp.stages, array['To do', 'In progress', 'Done'])) with ordinality s(name, i)
   where gp.id = p_project
     and lower(btrim(s.name)) = lower(btrim(p_name))
   order by s.i
   limit 1
$$;

/** See the header: the guard and the write-time checks. */
create or replace function public.guard_general_workflow_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gp       public.general_projects%rowtype;
  v_system boolean := auth.uid() is null
                      or coalesce(current_setting('collabify.workflow_rule_run', true), '') = 'on';
  v_trig   boolean;
  v_act    boolean;
  v_stage  record;
  v_role   text;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'A rule stays in its project.' using errcode = 'check_violation';
    end if;
    new.position := old.position;
    -- A creator's account going (on delete set null) clears it; nobody repoints it.
    if new.created_by is not null then
      new.created_by := old.created_by;
    end if;
    new.created_at := old.created_at;
  end if;

  select * into gp from public.general_projects where id = new.project_id;
  if gp.id is null then
    return new;   -- the foreign key refuses it
  end if;

  -- Ahead of the permission check: RLS's refusal would hide why.
  if tg_op = 'INSERT' and gp.class_board_id is not null then
    raise exception 'Workflow rules are for work projects.' using errcode = 'check_violation';
  end if;

  -- A signed-in person who may not write rules gets RLS's refusal, with no
  -- lock taken and nothing else said. The project manager or a coordinator
  -- of an archived project is told why.
  if not v_system and not public.general_can_manage_workflow(gp.id) then
    if gp.archived_at is not null
       and coalesce(public.general_role_of(gp.id, auth.uid())::text, '') in ('pm', 'coordinator') then
      raise exception '%', public.general_archived_message(gp.id) using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if gp.archived_at is not null then
      raise exception '%', public.general_archived_message(gp.id) using errcode = 'check_violation';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('general_workflow_rules:' || gp.id::text, 0));
    if (select count(*) from public.general_workflow_rules where project_id = gp.id) >= 20 then
      raise exception 'A project can have up to 20 rules.' using errcode = 'check_violation';
    end if;
    new.position := coalesce((select max(position) from public.general_workflow_rules
                               where project_id = gp.id), 0) + 1;
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.created_at := now();
    new.updated_at := now();
    if not v_system then
      new.last_skipped_at := null;
      new.last_skip_reason := null;
    end if;
    v_trig := true;
    v_act := true;
  else
    if not v_system then
      new.last_skipped_at := old.last_skipped_at;
      new.last_skip_reason := old.last_skip_reason;
      new.updated_at := now();
    end if;
    v_trig := new.trigger_kind is distinct from old.trigger_kind
           or new.trigger_stage is distinct from old.trigger_stage
           or new.trigger_priority is distinct from old.trigger_priority;
    -- A person cleared with nobody signed in is the account going (on delete
    -- set null); a signed-in person clearing it must choose someone.
    v_act := new.action_kind is distinct from old.action_kind
          or new.notify_to is distinct from old.notify_to
          or new.action_priority is distinct from old.action_priority
          or new.action_stage is distinct from old.action_stage
          or (new.person_id is distinct from old.person_id
              and (new.person_id is not null or auth.uid() is not null));
    if not v_system and (v_trig or v_act) then
      new.last_skipped_at := null;
      new.last_skip_reason := null;
    end if;
  end if;

  new.name := btrim(coalesce(new.name, ''));

  if v_trig and new.trigger_kind = 'stage_entered' and new.trigger_stage is not null then
    select * into v_stage from public.general_workflow_stage(gp.id, new.trigger_stage);
    if not found then
      raise exception 'Choose a stage in this project.' using errcode = 'check_violation';
    end if;
    new.trigger_stage := v_stage.name;
  end if;

  if v_act and new.action_kind = 'move_stage' and new.action_stage is not null then
    select * into v_stage from public.general_workflow_stage(gp.id, new.action_stage);
    if not found then
      raise exception 'Choose a stage in this project.' using errcode = 'check_violation';
    end if;
    if v_stage.idx = v_stage.n - 1 then
      raise exception 'Choose a stage that isn''t the last one.' using errcode = 'check_violation';
    end if;
    new.action_stage := v_stage.name;
  end if;

  if v_act and (new.action_kind = 'assign' or coalesce(new.notify_to = 'person', false)) then
    if new.person_id is null then
      raise exception 'Choose someone in this project.' using errcode = 'check_violation';
    end if;
    select m.role::text into v_role
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = gp.id and m.user_id = new.person_id and pr.status = 'active';
    if new.action_kind = 'assign' then
      if v_role is null or v_role in ('qa', 'stakeholder') then
        raise exception 'That person can''t be given tasks.' using errcode = 'check_violation';
      end if;
    elsif v_role is null or v_role = 'stakeholder' then
      raise exception 'Choose someone in this project.' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists general_workflow_rules_guard on public.general_workflow_rules;
create trigger general_workflow_rules_guard
  before insert or update on public.general_workflow_rules
  for each row execute function public.guard_general_workflow_rule();

alter table public.general_workflow_rules enable row level security;

drop policy if exists general_workflow_rules_select on public.general_workflow_rules;
create policy general_workflow_rules_select on public.general_workflow_rules
  for select to authenticated
  using (public.is_general_member(project_id) or public.can_read_general_project(project_id));

drop policy if exists general_workflow_rules_insert on public.general_workflow_rules;
create policy general_workflow_rules_insert on public.general_workflow_rules
  for insert to authenticated
  with check (public.general_can_manage_workflow(project_id));

drop policy if exists general_workflow_rules_update on public.general_workflow_rules;
create policy general_workflow_rules_update on public.general_workflow_rules
  for update to authenticated
  using (public.general_can_manage_workflow(project_id))
  with check (public.general_can_manage_workflow(project_id));

drop policy if exists general_workflow_rules_delete on public.general_workflow_rules;
create policy general_workflow_rules_delete on public.general_workflow_rules
  for delete to authenticated
  using (public.general_can_manage_workflow(project_id));

revoke all on table public.general_workflow_rules from public, anon, authenticated;
grant select, insert, update, delete on table public.general_workflow_rules to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.general_workflow_rules;
  exception
    when duplicate_object then null;
    when undefined_object then null;   -- no realtime publication on this database
  end;
  alter table public.general_workflow_rules replica identity full;
end $$;

-- ---------------------------------------------------------------- grants

revoke all on function public.general_can_manage_workflow(uuid) from public, anon;
grant execute on function public.general_can_manage_workflow(uuid) to authenticated;
revoke all on function public.general_workflow_stage(uuid, text) from public, anon, authenticated;
revoke all on function public.guard_general_workflow_rule() from public, anon, authenticated;

commit;
