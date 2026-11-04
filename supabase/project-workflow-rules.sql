-- supabase/project-workflow-rules.sql
--
-- A work project's workflow rules: "When {trigger}, then {action}", one of
-- each per rule, at most 20 per project, each on or off: the rules table, who
-- reads and writes it, the write-time checks, the notification type, the
-- history event kind and the rule runner.
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
-- Notification type workflow_rule. History event kind rule_applied (in the
-- general_task_events_kind check this file rewrites last; work-task-handoff.sql
-- and project-qa.sql list it too, so their re-runs keep rule history;
-- actor_id is nullable, so a rule's entry carries no person).
--
-- The runner, run_general_workflow_rules(task, trigger, actor, context):
--   fired by general_tasks_zzz_workflow (after update, after every other
--   general_tasks trigger), run_due_general_workflow_rules (each minute),
--   and general_task_reminders_workflow (daily fallback):
--     task_released    routing_state became released (not a subtask, which
--                      follows its parent): a first send and a re-send after a
--                      return, never a reroute
--     stage_entered    an already released task's stage changed into the
--                      rule's stage (by name, case-insensitive; a renamed
--                      stage never fires). A release landing in a default
--                      stage fires only task_released.
--     priority_raised  the priority went from below the rule's level to it or
--                      above (High means High or Urgent)
--     task_overdue     the first poll after the due time; the daily reminder
--                      is a fallback, while the silent pre-mark does not fire
--   Only released, live tasks of live work projects; class boards never.
--   The enabled rules for the trigger run in creation order, each in its own
--   savepoint, with collabify.workflow_rule_run on (so a rule's own change
--   sets off no rules, and the rule row's skip fields accept the write) and
--   the request's JWT claims cleared (the rule acts for the project, as
--   create_general_subtask does); both are restored afterwards. The existing
--   task guards still apply: a refusal skips that action only, records its
--   message, and the person's change stays.
--   Actions (apply_general_workflow_rule):
--     notify        workflow_rule to the team lead, the planners, QA, the
--                   holders or the person: current active members, not
--                   stakeholders, not the person whose change set it off,
--                   with their own "Task assignments" on. Titles "{task}
--                   moved to {stage}", "{task} was sent to {team}" ("was sent
--                   out" with no team), "{task} is overdue", "{task} is now
--                   {Priority}"; preview "From the rule “{name or sentence}”."
--     set_priority  no change when it already has that priority
--     assign        only someone on the task's team who may hold tasks; no
--                   change when they already hold it. The person is told
--                   ("{task} was given to you", same preview), with their own
--                   "Task assignments" on, unless the change was theirs.
--     move_stage    never to the last stage, never past an active QA stage,
--                   never out of Done; no change when it is already there
--   Rule-limit skips: "Stage {name} no longer exists.", "{name} is no longer
--   in the project.", "{name} is a stakeholder now." (a person to notify),
--   "{name} isn't on the task's team.", "{name} can't hold tasks.", "A task
--   can't be moved past QA by a rule.", "A task can't be moved to the last
--   stage by a rule.", "A rule doesn't reopen finished work." A task taken
--   out of the work meanwhile (no longer released, archived or trashed) is
--   left alone. A failed skip write is ignored. Nobody to tell and no change
--   are not skips and write nothing. Both fire functions return at once when
--   the project has no enabled rules. Each applied action writes a rule_applied history
--   row with no actor and detail {rule_id, rule_name, action, ...}.
--   general_workflow_rule_sentence(rule) is the rule as a sentence.
--
-- Redefined from its live definition: mark_project_reminders_sent (owned by
-- project-notification-rules.sql), unchanged except for the pre-mark flag.
--
-- In realtime, replica identity full.
--
-- Class boards and class tables are untouched.
--
-- Run after project-notification-rules.sql, then anon-lockdown.sql. Re-running
-- work-task-handoff.sql or project-qa.sql means re-running this file
-- afterwards, then anon-lockdown.sql, so the runner and its triggers stay last
-- in the chain. Their copies of general_task_events_kind list rule_applied, so
-- those re-runs no longer refuse or drop a rule's history rows. Re-running
-- project-notification-rules.sql means re-running this file afterwards too:
-- it replaces mark_project_reminders_sent and clear_general_task_reminder.
-- Its closing pre-mark may fire newly overdue rules before this file restores
-- the silent pre-mark flag; the minute poll and daily fallback share one stamp.
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

-- ---------------------------------------------------------------- the runner

/**
 * A rule as one sentence, e.g. "When a task moves to Review, notify the team
 * lead". The app has its own copy (lib/general/workflowRules.ts).
 */
create or replace function public.general_workflow_rule_sentence(p_rule public.general_workflow_rules)
returns text language sql stable security definer set search_path = public as $$
  select 'When '
      || case p_rule.trigger_kind
           when 'stage_entered' then 'a task moves to ' || p_rule.trigger_stage
           when 'task_released' then 'a task is sent to a team'
           when 'task_overdue'  then 'a task becomes overdue'
           else 'a task''s priority is raised to ' || initcap(p_rule.trigger_priority)
         end
      || ', '
      || case p_rule.action_kind
           when 'notify' then 'notify ' || case p_rule.notify_to
               when 'team_lead' then 'the team lead'
               when 'planners'  then 'the project manager and coordinators'
               when 'qa'        then 'QA'
               when 'holders'   then 'the task''s holders'
               else coalesce(x.who, 'someone no longer in the project')
             end
           when 'set_priority' then 'set the priority to ' || initcap(p_rule.action_priority)
           when 'assign' then 'assign ' || coalesce(x.who, 'someone no longer in the project')
           else 'move it to ' || p_rule.action_stage
         end
    from (select (select nullif(btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), '')
                    from public.profiles pr where pr.id = p_rule.person_id) as who) x
$$;

/**
 * Applies one rule to a released task, as the project. Called only by
 * run_general_workflow_rules, inside its savepoint, with the request's claims
 * cleared and collabify.workflow_rule_run on. Returns null when the action
 * was applied or changed nothing, or the reason a rule limit skips it. A
 * database refusal raises, and the runner records its message. An applied
 * action writes a rule_applied history row (no actor; detail rule_id,
 * rule_name, action, plus what it did). p_value is the stage entered or the
 * priority reached, for the notice's title.
 */
create or replace function public.apply_general_workflow_rule(
  p_rule public.general_workflow_rules, p_task uuid, p_trigger text, p_actor uuid, p_value text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t        public.general_tasks%rowtype;
  gp       public.general_projects%rowtype;
  n        int;
  v_idx    int;
  v_who    text;
  v_role   text;
  v_team   text;
  v_title  text;
  v_target record;
  v_sent   int;
  v_detail jsonb;
begin
  -- Only an action that writes the task locks its row; a notice only reads it.
  if p_rule.action_kind = 'notify' then
    select * into t from public.general_tasks where id = p_task;
  else
    select * into t from public.general_tasks where id = p_task for update;
  end if;
  -- An earlier rule or a concurrent change may have taken it out of the work.
  if t.id is null or t.routing_state is distinct from 'released'
     or t.archived_at is not null or t.trashed_at is not null then
    return null;
  end if;
  select * into gp from public.general_projects where id = t.project_id;
  n := public.stage_count(gp.stages);
  v_idx := public.general_task_stage_at(t.status, t.stage, n);

  if p_rule.action_kind = 'assign' or p_rule.notify_to = 'person' then
    select nullif(btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), '')
      into v_who from public.profiles pr where pr.id = p_rule.person_id;
    v_who := coalesce(v_who, 'The rule''s person');
    select m.role::text into v_role
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = t.project_id and m.user_id = p_rule.person_id and pr.status = 'active';
    if v_role is null then
      return format('%s is no longer in the project.', v_who);
    end if;
    if p_rule.action_kind = 'notify' and v_role = 'stakeholder' then
      return format('%s is a stakeholder now.', v_who);
    end if;
  end if;

  case p_rule.action_kind
  when 'notify' then
    select g.name into v_team from public.general_teams g where g.id = t.team_id;
    v_title := case p_trigger
      when 'stage_entered' then format('%s moved to %s', t.title, p_value)
      when 'task_released' then
        case when v_team is null then format('%s was sent out', t.title)
             else format('%s was sent to %s', t.title, v_team) end
      when 'task_overdue' then format('%s is overdue', t.title)
      else format('%s is now %s', t.title, initcap(p_value))
    end;
    insert into public.notifications
      (user_id, type, general_project_id, general_task_id, title, preview)
    select m.user_id, 'workflow_rule'::public.notification_type, t.project_id, t.id, v_title,
           format('From the rule “%s”.',
                  coalesce(nullif(p_rule.name, ''), public.general_workflow_rule_sentence(p_rule)))
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
      join public.notification_prefs np on np.user_id = m.user_id and np.task_assignments
     where m.project_id = t.project_id
       and m.role <> 'stakeholder'
       and pr.status = 'active'
       and m.user_id is distinct from p_actor
       and case p_rule.notify_to
             when 'team_lead' then exists (
               select 1 from public.general_teams g
                 join public.general_team_members tm
                   on tm.team_id = g.id and tm.project_id = g.project_id and tm.user_id = g.leader_id
                where g.id = t.team_id and g.project_id = t.project_id
                  and g.archived_at is null and g.leader_id = m.user_id)
             when 'planners' then m.role in ('pm', 'coordinator')
             when 'qa' then m.role = 'qa'
             when 'holders' then exists (
               select 1 from public.general_task_assignees a
                where a.task_id = t.id and a.user_id = m.user_id)
             else m.user_id = p_rule.person_id
           end;
    get diagnostics v_sent = row_count;
    if v_sent = 0 then
      return null;   -- nobody to tell is not a skip
    end if;
    v_detail := jsonb_build_object('notify_to', p_rule.notify_to, 'recipients', v_sent);

  when 'set_priority' then
    if t.priority = p_rule.action_priority then
      return null;
    end if;
    update public.general_tasks set priority = p_rule.action_priority where id = t.id;
    v_detail := jsonb_build_object('priority', p_rule.action_priority, 'priority_from', t.priority);

  when 'assign' then
    if v_role in ('qa', 'stakeholder') then
      return format('%s can''t hold tasks.', v_who);
    end if;
    if exists (select 1 from public.general_task_assignees a
                where a.task_id = t.id and a.user_id = p_rule.person_id) then
      return null;
    end if;
    if not exists (select 1 from public.general_teams g
                     join public.general_team_members tm
                       on tm.team_id = g.id and tm.project_id = g.project_id
                    where g.id = t.team_id and g.project_id = t.project_id
                      and g.archived_at is null and tm.user_id = p_rule.person_id) then
      return format('%s isn''t on the task''s team.', v_who);
    end if;
    -- The one-holder rule and the other assignee guards refuse it here.
    insert into public.general_task_assignees (project_id, task_id, user_id)
    values (t.project_id, t.id, p_rule.person_id);
    -- assigned_by stays null (no person gave it), so the assignment notice
    -- doesn't go; the rule tells them instead.
    insert into public.notifications
      (user_id, type, general_project_id, general_task_id, title, preview)
    select p_rule.person_id, 'workflow_rule'::public.notification_type, t.project_id, t.id,
           format('%s was given to you', t.title),
           format('From the rule “%s”.',
                  coalesce(nullif(p_rule.name, ''), public.general_workflow_rule_sentence(p_rule)))
      from public.notification_prefs np
     where np.user_id = p_rule.person_id and np.task_assignments
       and p_rule.person_id is distinct from p_actor;
    v_detail := jsonb_build_object('user_id', p_rule.person_id);

  when 'move_stage' then
    select * into v_target from public.general_workflow_stage(t.project_id, p_rule.action_stage);
    if not found then
      return format('Stage %s no longer exists.', p_rule.action_stage);
    end if;
    if t.status = 'done' then
      return 'A rule doesn''t reopen finished work.';
    end if;
    if v_target.idx >= v_target.n - 1 then
      return 'A task can''t be moved to the last stage by a rule.';
    end if;
    if public.general_project_has_qa(t.project_id)
       and v_target.idx > public.general_qa_stage_pick(gp.stages, gp.qa_stage) then
      return 'A task can''t be moved past QA by a rule.';
    end if;
    if v_idx = v_target.idx then
      return null;
    end if;
    -- Never the last stage, so the status is To do or In progress.
    update public.general_tasks
       set stage = v_target.idx,
           status = case when v_target.idx = 0 then 'todo' else 'in_progress' end::public.general_task_status
     where id = t.id;
    v_detail := jsonb_build_object(
      'stage', v_target.name,
      'stage_from', (coalesce(gp.stages, array['To do', 'In progress', 'Done']))[v_idx + 1]);
  end case;

  insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
  values (t.id, t.project_id, null, 'rule_applied',
          jsonb_build_object(
            'rule_id', p_rule.id,
            'rule_name', coalesce(nullif(p_rule.name, ''), public.general_workflow_rule_sentence(p_rule)),
            'action', p_rule.action_kind) || v_detail);
  return null;
end;
$$;

/**
 * Runs a project's enabled rules for one trigger on one task, in creation
 * order. Nothing happens while collabify.workflow_rule_run is on (a rule's
 * own change sets off no rules), or unless the task is released and live in
 * a live work project. Each action runs in its own savepoint with the flag on
 * and the request's JWT claims cleared (as create_general_subtask does), so
 * it acts for the project rather than the person, and the existing task
 * guards (dependencies, subtasks, holders, one holder) still refuse what they
 * refuse. A skip writes the rule's last_skipped_at and last_skip_reason. The
 * claims and the flag are always restored.
 * p_context: {"stage": name} for stage_entered (the stage entered),
 * {"from": old, "to": new} for priority_raised. Without it the task's current
 * stage and priority stand in.
 */
create or replace function public.run_general_workflow_rules(
  p_task uuid, p_trigger text, p_actor uuid, p_context jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ranks constant text[] := array['low', 'normal', 'high', 'urgent'];
  t       public.general_tasks%rowtype;
  gp      public.general_projects%rowtype;
  r       public.general_workflow_rules%rowtype;
  v_stage text;
  v_to    text;
  v_from  text;
  v_skip  text;
  prior_claims text := current_setting('request.jwt.claims', true);
  prior_sub    text := current_setting('request.jwt.claim.sub', true);
begin
  if coalesce(current_setting('collabify.workflow_rule_run', true), '') = 'on' then
    return;
  end if;
  select * into t from public.general_tasks where id = p_task;
  if t.id is null or t.routing_state is distinct from 'released'
     or t.archived_at is not null or t.trashed_at is not null then
    return;
  end if;
  select * into gp from public.general_projects where id = t.project_id;
  if gp.class_board_id is not null or gp.archived_at is not null or gp.trashed_at is not null then
    return;
  end if;
  if not exists (select 1 from public.general_workflow_rules w
                  where w.project_id = gp.id and w.enabled and w.trigger_kind = p_trigger) then
    return;
  end if;

  v_stage := coalesce(p_context->>'stage',
    (coalesce(gp.stages, array['To do', 'In progress', 'Done']))
      [public.general_task_stage_at(t.status, t.stage, public.stage_count(gp.stages)) + 1]);
  v_to := coalesce(p_context->>'to', t.priority);
  v_from := p_context->>'from';

  begin
    perform set_config('collabify.workflow_rule_run', 'on', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    for r in
      select w.* from public.general_workflow_rules w
       where w.project_id = gp.id and w.enabled and w.trigger_kind = p_trigger
         and (p_trigger <> 'stage_entered'
              or lower(btrim(w.trigger_stage)) = lower(btrim(v_stage)))
         and (p_trigger <> 'priority_raised'
              or (array_position(ranks, v_to) >= array_position(ranks, w.trigger_priority)
                  and coalesce(array_position(ranks, v_from), 0)
                      < array_position(ranks, w.trigger_priority)))
       order by w.position
    loop
      begin
        v_skip := public.apply_general_workflow_rule(r, p_task, p_trigger, p_actor,
                    case p_trigger when 'stage_entered' then v_stage
                                   when 'priority_raised' then v_to end);
      exception when others then
        v_skip := sqlerrm;   -- the database refused it; the savepoint undid it
      end;
      if v_skip is not null then
        -- A failed skip write never undoes the person's change.
        begin
          update public.general_workflow_rules
             set last_skipped_at = now(), last_skip_reason = left(v_skip, 500)
           where id = r.id;
        exception when others then
          null;
        end;
      end if;
    end loop;
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
    perform set_config('collabify.workflow_rule_run', 'off', true);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
    perform set_config('collabify.workflow_rule_run', 'off', true);
    raise;
  end;
end;
$$;

/**
 * After a task change is final: a task sent out of planning (not a subtask,
 * which follows its parent), a released task whose stage changed, and a
 * priority raised. Each calls the runner with what the change was, so a rule
 * that already acted on this change can't make the next trigger see its work.
 */
create or replace function public.fire_general_workflow_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ranks constant text[] := array['low', 'normal', 'high', 'urgent'];
  v_stages text[];
  n        int;
  new_i    int;
  me       uuid := auth.uid();
begin
  -- Most projects have no rules: one index lookup and out.
  if not exists (select 1 from public.general_workflow_rules w
                  where w.project_id = new.project_id and w.enabled) then
    return null;
  end if;
  if coalesce(current_setting('collabify.workflow_rule_run', true), '') = 'on'
     or new.routing_state is distinct from 'released' then
    return null;
  end if;

  if old.routing_state is distinct from 'released' and new.parent_id is null then
    perform public.run_general_workflow_rules(new.id, 'task_released', me);
  end if;

  select gp.stages into v_stages from public.general_projects gp where gp.id = new.project_id;
  n := public.stage_count(v_stages);
  new_i := public.general_task_stage_at(new.status, new.stage, n);
  -- A release fires only the "sent" rules, even when it lands in a default stage.
  if old.routing_state = 'released'
     and new_i is distinct from public.general_task_stage_at(old.status, old.stage, n) then
    perform public.run_general_workflow_rules(new.id, 'stage_entered', me,
      jsonb_build_object('stage', (coalesce(v_stages, array['To do', 'In progress', 'Done']))[new_i + 1]));
  end if;

  if coalesce(array_position(ranks, new.priority), 0) > coalesce(array_position(ranks, old.priority), 0) then
    perform public.run_general_workflow_rules(new.id, 'priority_raised', me,
      jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;
  return null;
end;
$$;

-- After every other general_tasks trigger ('zzz' sorts after 'zz_').
drop trigger if exists general_tasks_zzz_workflow on public.general_tasks;
create trigger general_tasks_zzz_workflow
  after update on public.general_tasks
  for each row
  when (new.routing_state = 'released'
        and (old.routing_state is distinct from new.routing_state
             or old.stage is distinct from new.stage
             or old.status is distinct from new.status
             or old.priority is distinct from new.priority))
  execute function public.fire_general_workflow_rules();

/**
 * Workflow overdue rules need their own stamp: task reminders run once each
 * morning, while a rule must act when the due time passes.
 */
create table if not exists public.general_workflow_overdue_runs (
  task_id uuid primary key references public.general_tasks (id) on delete cascade
);

alter table public.general_workflow_overdue_runs enable row level security;
revoke all on table public.general_workflow_overdue_runs from public, anon, authenticated;

-- Tasks already handled by the daily reminder must not fire again on rollout.
insert into public.general_workflow_overdue_runs (task_id)
select task_id from public.general_task_reminders
on conflict do nothing;

create or replace function public.clear_general_task_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.general_task_reminders where task_id = new.id;
  delete from public.general_workflow_overdue_runs where task_id = new.id;
  return null;
end;
$$;

create or replace function public.run_due_general_workflow_rules(
  p_now timestamptz default now(), p_project uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task uuid;
  v_count int := 0;
begin
  for v_task in
    with due as (
      select t.id
        from public.general_tasks t
        join public.general_projects gp on gp.id = t.project_id
       where (p_project is null or t.project_id = p_project)
         and gp.class_board_id is null
         and gp.archived_at is null and gp.trashed_at is null
         and t.routing_state = 'released'
         and t.archived_at is null and t.trashed_at is null
         and t.status <> 'done' and t.due_at <= p_now
         and not exists (select 1 from public.general_workflow_overdue_runs x
                          where x.task_id = t.id)
    ), stamped as (
      insert into public.general_workflow_overdue_runs (task_id)
      select id from due
      on conflict do nothing
      returning task_id
    )
    select task_id from stamped
  loop
    perform public.run_general_workflow_rules(v_task, 'task_overdue', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Daily reminders remain at 08:00 Manila; workflow deadlines poll each minute.
do $$
begin
  perform cron.unschedule('collabify-workflow-overdue');
exception when others then null; end $$;

select cron.schedule(
  'collabify-workflow-overdue',
  '* * * * *',
  $cron$ select public.run_due_general_workflow_rules() $cron$
);

-- The daily reminder is a fallback if its stamp beats the minute poll.
create or replace function public.fire_general_workflow_overdue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task uuid;
begin
  if not exists (select 1 from public.general_workflow_rules w
                  where w.project_id = new.project_id and w.enabled) then
    return null;
  end if;
  if coalesce(current_setting('collabify.reminder_premark', true), '') = 'on'
     or coalesce(current_setting('collabify.workflow_rule_run', true), '') = 'on' then
    return null;
  end if;
  insert into public.general_workflow_overdue_runs (task_id)
  values (new.task_id) on conflict do nothing returning task_id into v_task;
  if v_task is not null then
    perform public.run_general_workflow_rules(v_task, 'task_overdue', null);
  end if;
  return null;
end;
$$;

drop trigger if exists general_task_reminders_workflow on public.general_task_reminders;
create trigger general_task_reminders_workflow
  after insert on public.general_task_reminders
  for each row execute function public.fire_general_workflow_overdue();

/**
 * Redefined from the live definition (project-notification-rules.sql owns
 * it): unchanged, except the overdue stamps are written with
 * collabify.reminder_premark on, so the silent pre-mark sets off no
 * "becomes overdue" rules.
 */
create or replace function public.mark_project_reminders_sent(
  p_now timestamptz default now(),
  p_project uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (p_now at time zone 'Asia/Manila')::date;
  v_sprints int;
  v_tasks int;
  v_milestones int;
  prior_premark text := current_setting('collabify.reminder_premark', true);
begin
  update public.general_sprints s
     set end_reminded_at = p_now
    from public.general_projects gp
   where gp.id = s.project_id
     and (p_project is null or s.project_id = p_project)
     and gp.class_board_id is null
     and gp.archived_at is null
     and gp.trashed_at is null
     and s.state = 'active'
     and s.ends_on >= v_today
     and s.ends_on - v_today <= coalesce(gp.sprint_end_reminder_days, 3)
     and s.end_reminded_at is null;
  get diagnostics v_sprints = row_count;

  perform set_config('collabify.reminder_premark', 'on', true);
  insert into public.general_task_reminders (task_id, project_id, overdue_notified_at)
  select t.id, t.project_id, p_now
    from public.general_tasks t
    join public.general_projects gp on gp.id = t.project_id
   where (p_project is null or t.project_id = p_project)
     and gp.class_board_id is null
     and gp.archived_at is null
     and gp.trashed_at is null
     and t.routing_state = 'released'
     and t.archived_at is null
     and t.trashed_at is null
     and t.status <> 'done'
     and t.due_at is not null
     and (t.due_at at time zone 'Asia/Manila')::date < v_today
  on conflict (task_id) do nothing;
  get diagnostics v_tasks = row_count;
  perform set_config('collabify.reminder_premark', coalesce(nullif(prior_premark, ''), 'off'), true);

  update public.general_milestones m
     set due_reminded_at = p_now
    from public.general_projects gp
   where gp.id = m.project_id
     and (p_project is null or m.project_id = p_project)
     and gp.class_board_id is null
     and gp.archived_at is null
     and gp.trashed_at is null
     and m.reached_at is null
     and m.due_on >= v_today
     and m.due_on - v_today <= coalesce(gp.milestone_due_reminder_days, 7)
     and m.due_reminded_at is null;
  get diagnostics v_milestones = row_count;

  return v_sprints + v_tasks + v_milestones;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.general_workflow_rule_sentence(public.general_workflow_rules) from public, anon, authenticated;
revoke all on function public.apply_general_workflow_rule(public.general_workflow_rules, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.run_general_workflow_rules(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fire_general_workflow_rules() from public, anon, authenticated;
revoke all on function public.fire_general_workflow_overdue() from public, anon, authenticated;
revoke all on function public.run_due_general_workflow_rules(timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.mark_project_reminders_sent(timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.general_can_manage_workflow(uuid) from public, anon;
grant execute on function public.general_can_manage_workflow(uuid) to authenticated;
revoke all on function public.general_workflow_stage(uuid, text) from public, anon, authenticated;
revoke all on function public.guard_general_workflow_rule() from public, anon, authenticated;

commit;
