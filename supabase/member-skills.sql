-- Collabify — assign by position: skill tags and the assign context.
--
--   node scripts/db.mjs supabase/member-skills.sql supabase/anon-lockdown.sql
--
-- A work project member carries skill tags, per project: trimmed, inner spaces
-- collapsed, 1 to 40 characters, unique per person ignoring case, at most 12
-- each. The app normalizes a tag before it inserts it; the check refuses one
-- that isn't.
--
--   who                                        edit own tags   edit anyone's   read
--   pm, coordinator                            yes             yes             yes
--   member granted manage_tasks or
--     manage_structure                         yes             yes             yes
--   member                                     yes                             yes
--   qa, stakeholder                            (have none)                     yes
--
-- A tag is replaced by delete plus insert; nothing updates one in place. QA and
-- stakeholders take no tasks, so they carry no tags: inserting one for them is
-- refused, and becoming one drops the person's tags in that project. An
-- archived project's tags are frozen (guard_general_structure, owned by
-- project-team-leads.sql), but leaving or being removed from it still takes
-- the person's tags along.
--
-- general_assign_context(project) gives the pm and coordinators (anyone holding
-- manage_tasks on a work project) what Assign by position drafts from: the
-- candidates (pm, coordinator or member with an active account) with their
-- open load, teams, positions and tags; the positions somebody among them
-- holds; and up to 60 unassigned open tasks, oldest first, before the QA stage
-- when the project has QA, plus how many more there are.
--
-- Runs after project-qa.sql and before anon-lockdown.sql (docs/07-backup.md).
-- It owns only the objects it creates and redefines nothing another file owns,
-- so it is outside the CLAUDE.md seven-file re-run chain.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- the table

create table if not exists public.general_member_skills (
  project_id uuid not null,
  user_id    uuid not null,
  tag        text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id, tag),
  foreign key (project_id, user_id)
    references public.general_members (project_id, user_id) on delete cascade,
  constraint general_member_skills_tag_check
    check (tag = btrim(regexp_replace(tag, '\s+', ' ', 'g'))
           and char_length(tag) between 1 and 40)
);

create unique index if not exists general_member_skills_tag_ci
  on public.general_member_skills (project_id, user_id, lower(tag));

alter table public.general_member_skills enable row level security;

revoke all on public.general_member_skills from public, anon, authenticated;
grant select, insert, delete on public.general_member_skills to authenticated;

-- ---------------------------------------------------------------- row-level security

drop policy if exists general_member_skills_select on public.general_member_skills;
create policy general_member_skills_select on public.general_member_skills
  for select to authenticated
  using (public.is_general_member(project_id));

drop policy if exists general_member_skills_insert on public.general_member_skills;
create policy general_member_skills_insert on public.general_member_skills
  for insert to authenticated
  with check (
    public.general_can_write(project_id)
    and (user_id = auth.uid()
         or public.general_has(project_id, 'manage_tasks')
         or public.general_has(project_id, 'manage_structure'))
  );

drop policy if exists general_member_skills_delete on public.general_member_skills;
create policy general_member_skills_delete on public.general_member_skills
  for delete to authenticated
  using (
    public.general_can_write(project_id)
    and (user_id = auth.uid()
         or public.general_has(project_id, 'manage_tasks')
         or public.general_has(project_id, 'manage_structure'))
  );

-- ---------------------------------------------------------------- triggers

-- The archived refusal, for a person's own inserts and deletes. A delete that
-- cascades from general_members (leaving or being removed from an archived
-- project) or comes from general_member_skills_drop runs inside a trigger, so
-- pg_trigger_depth() is above 0 and it goes through.
drop trigger if exists general_member_skills_guard on public.general_member_skills;
create trigger general_member_skills_guard
  before insert or delete on public.general_member_skills
  for each row when (pg_trigger_depth() < 1)
  execute function public.guard_general_structure();

/** QA and stakeholders carry no tags, and nobody carries more than 12. */
create or replace function public.general_member_skills_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  -- BEFORE triggers run ahead of the RLS check: somebody who can't write here
  -- learns nothing about the project's people, and row-level security refuses.
  if auth.uid() is not null and not public.general_can_write(new.project_id) then
    return new;
  end if;
  -- Locks the person's membership row, so two inserts at once can't both be
  -- the 12th.
  select m.role::text into v_role
    from public.general_members m
   where m.project_id = new.project_id and m.user_id = new.user_id
     for no key update;
  if v_role is null then
    return new;  -- the foreign key refuses it
  end if;
  if v_role in ('qa', 'stakeholder') then
    raise exception 'QA and stakeholders don''t take tasks, so they have no skills.'
      using errcode = 'check_violation';
  end if;
  if (select count(*) from public.general_member_skills s
       where s.project_id = new.project_id and s.user_id = new.user_id) >= 12 then
    raise exception 'Up to 12 skills each.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists general_member_skills_rules on public.general_member_skills;
create trigger general_member_skills_rules
  before insert on public.general_member_skills
  for each row execute function public.general_member_skills_check();

/** Becoming QA or a stakeholder drops the person's tags in that project. */
create or replace function public.general_member_skills_drop()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.general_member_skills
   where project_id = new.project_id and user_id = new.user_id;
  return null;
end;
$$;

drop trigger if exists general_members_skills_drop on public.general_members;
create trigger general_members_skills_drop
  after update of role on public.general_members
  for each row when (new.role in ('qa', 'stakeholder') and old.role is distinct from new.role)
  execute function public.general_member_skills_drop();

-- ---------------------------------------------------------------- the assign context

/**
 * What Assign by position drafts from, for the pm and coordinators (anyone
 * holding manage_tasks) on a live work project:
 *   positions   the positions a candidate holds: id, name, team_id, team
 *   candidates  pm, coordinator or member with an active account: user_id,
 *               name, load (tasks held here, not done, not archived), teams
 *               (general_team_members), positions (general_position_holders),
 *               tags
 *   tasks       up to 60 open, unarchived tasks nobody holds, oldest first;
 *               with QA on the project, only those before the QA stage: id,
 *               title, description, team_id
 *   left        how many eligible tasks the 60 leave out
 */
create or replace function public.general_assign_context(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_n      int;
  v_has_qa boolean;
  v_qa     int;
  v_total  int;
  v_cands  jsonb;
  v_pos    jsonb;
  v_tasks  jsonb;
begin
  select public.stage_count(gp.stages) into v_n
    from public.general_projects gp
   where gp.id = p_project and gp.class_board_id is null;
  if v_n is null or not coalesce(public.general_has(p_project, 'manage_tasks'), false) then
    raise exception 'Only the project manager and coordinators can assign by position.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;

  v_has_qa := coalesce(public.general_project_has_qa(p_project), false);
  v_qa := public.general_qa_stage_index(p_project);

  with cands as (
    select m.user_id,
           btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')) as name
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project
       and m.role in ('pm', 'coordinator', 'member')
       and pr.status = 'active'
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', c.user_id,
               'name', c.name,
               'load', (select count(*)
                          from public.general_task_assignees a
                          join public.general_tasks t on t.id = a.task_id
                         where a.project_id = p_project and a.user_id = c.user_id
                           and t.status <> 'done' and t.archived_at is null),
               'teams', coalesce((select jsonb_agg(tm.team_id order by tm.team_id)
                                    from public.general_team_members tm
                                   where tm.project_id = p_project and tm.user_id = c.user_id),
                                 '[]'::jsonb),
               'positions', coalesce((select jsonb_agg(h.position_id order by h.position_id)
                                        from public.general_position_holders h
                                       where h.project_id = p_project and h.user_id = c.user_id),
                                     '[]'::jsonb),
               'tags', coalesce((select jsonb_agg(s.tag order by lower(s.tag))
                                   from public.general_member_skills s
                                  where s.project_id = p_project and s.user_id = c.user_id),
                                '[]'::jsonb)
             ) order by c.name, c.user_id)
        from cands c
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'team_id', p.team_id, 'team', tm.name
             ) order by p.sort, p.name, p.id)
        from public.general_positions p
        left join public.general_teams tm on tm.id = p.team_id
       where p.project_id = p_project
         and exists (select 1 from public.general_position_holders h
                       join cands c on c.user_id = h.user_id
                      where h.position_id = p.id and h.project_id = p_project)
    ), '[]'::jsonb)
    into v_cands, v_pos;

  with eligible as (
    select t.id, t.title, t.description, t.team_id, t.created_at
      from public.general_tasks t
     where t.project_id = p_project
       and t.status <> 'done'
       and t.archived_at is null
       and not exists (select 1 from public.general_task_assignees a where a.task_id = t.id)
       and (not v_has_qa
            or public.general_task_stage_at(t.status, t.stage, v_n) < v_qa)
  ),
  firsts as (
    select * from eligible order by created_at, id limit 60
  )
  select
    (select count(*) from eligible),
    coalesce((select jsonb_agg(jsonb_build_object(
                       'id', f.id, 'title', f.title,
                       'description', coalesce(f.description, ''), 'team_id', f.team_id
                     ) order by f.created_at, f.id)
                from firsts f), '[]'::jsonb)
    into v_total, v_tasks;

  return jsonb_build_object(
    'positions', v_pos,
    'candidates', v_cands,
    'tasks', v_tasks,
    'left', greatest(v_total - 60, 0)
  );
end;
$$;

revoke all on function public.general_member_skills_check() from public, anon, authenticated;
revoke all on function public.general_member_skills_drop() from public, anon, authenticated;
revoke all on function public.general_assign_context(uuid) from public, anon;
grant execute on function public.general_assign_context(uuid) to authenticated;

-- ---------------------------------------------------------------- realtime

-- Live updates for the Members tab; row-level security still decides who hears what.
do $$
declare
  t text;
begin
  foreach t in array array['general_member_skills'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

commit;
