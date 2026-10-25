-- Assign by position: skill tags and the assign context — rolled back, touches
-- nothing permanently.
--
--   node scripts/db.mjs supabase/tests/member-skills.test.sql
--
-- A work project member carries up to 12 skill tags (trimmed, inner spaces
-- collapsed, 1-40 characters, unique per person ignoring case). A member edits
-- their own; the pm, a coordinator or anyone holding manage_tasks or
-- manage_structure edits anybody's. QA and stakeholders take no tasks, so they
-- carry none, and becoming one drops the tags. An archived project's tags are
-- frozen, but leaving it still goes through. general_assign_context gives the
-- pm and coordinators the candidates (pm, coordinator, member with an active
-- account), their open load, the positions they hold, and up to 60 unassigned
-- open tasks before the QA stage, oldest first. Every refusal is paired with a
-- case that is allowed.

begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- A refusal that must be the one under test, not some other rule further along.
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      if position(lower(p_needle) in lower(sqlerrm)) > 0 then
        raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 60);
        return;
      end if;
      raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_allow(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
exception
  when others then
    raise exception 'FAIL  % — refused with: %', p_label, sqlerrm;
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

create or replace function pg_temp.tags_of(p_project uuid, p_user uuid) returns int
language sql as $$
  select count(*)::int from public.general_member_skills
   where project_id = p_project and user_id = p_user
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_pm   uuid := gen_random_uuid();  -- member account, Project manager on
  v_c    uuid := gen_random_uuid();  -- coordinator
  v_m    uuid := gen_random_uuid();  -- member
  v_m2   uuid := gen_random_uuid();  -- member, granted manage_tasks
  v_m3   uuid := gen_random_uuid();  -- member, two tags, then qa
  v_m4   uuid := gen_random_uuid();  -- member, a tag, then coordinator
  v_q    uuid := gen_random_uuid();  -- qa
  v_s    uuid := gen_random_uuid();  -- stakeholder
  v_d    uuid := gen_random_uuid();  -- member, deactivated account
  v_pend uuid := gen_random_uuid();  -- member, pending account
  v_ms   uuid := gen_random_uuid();  -- member, granted manage_structure
  v_out  uuid := gen_random_uuid();  -- not on the project
  v_p    uuid;
  v_p2   uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,   'zz-sk-pm@example.test'),
      (v_c,    'zz-sk-c@example.test'),
      (v_m,    'zz-sk-m@example.test'),
      (v_m2,   'zz-sk-m2@example.test'),
      (v_m3,   'zz-sk-m3@example.test'),
      (v_m4,   'zz-sk-m4@example.test'),
      (v_q,    'zz-sk-q@example.test'),
      (v_s,    'zz-sk-s@example.test'),
      (v_d,    'zz-sk-d@example.test'),
      (v_pend, 'zz-sk-pend@example.test'),
      (v_ms,   'zz-sk-ms@example.test'),
      (v_out,  'zz-sk-out@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,   'zz-sk-pm@example.test',   'Zz', 'Skpm',   'member', 'active',   false, true),
    (v_c,    'zz-sk-c@example.test',    'Zz', 'Skc',    'member', 'active',   false, false),
    (v_m,    'zz-sk-m@example.test',    'Zz', 'Skm',    'member', 'active',   false, false),
    (v_m2,   'zz-sk-m2@example.test',   'Zz', 'Skm2',   'member', 'active',   false, false),
    (v_m3,   'zz-sk-m3@example.test',   'Zz', 'Skm3',   'member', 'active',   false, false),
    (v_m4,   'zz-sk-m4@example.test',   'Zz', 'Skm4',   'member', 'active',   false, false),
    (v_q,    'zz-sk-q@example.test',    'Zz', 'Skq',    'member', 'active',   false, false),
    (v_s,    'zz-sk-s@example.test',    'Zz', 'Sks',    'member', 'active',   false, false),
    (v_d,    'zz-sk-d@example.test',    'Zz', 'Skd',    'member', 'active',   false, false),
    (v_pend, 'zz-sk-pend@example.test', 'Zz', 'Skpend', 'member', 'pending',  false, false),
    (v_ms,   'zz-sk-ms@example.test',   'Zz', 'Skms',   'member', 'active',   false, false),
    (v_out,  'zz-sk-out@example.test',  'Zz', 'Skout',  'member', 'active',   false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_p := (public.create_general_project('Zz skills project', '')).id;
  v_p2 := (public.create_general_project('Zz skills busy project', '')).id;

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role)
  values (v_p, v_c, 'coordinator'), (v_p, v_m, 'member'), (v_p, v_m2, 'member'),
         (v_p, v_m3, 'member'), (v_p, v_m4, 'member'), (v_p, v_q, 'qa'),
         (v_p, v_s, 'stakeholder'), (v_p, v_d, 'member'), (v_p, v_pend, 'member'), (v_p, v_ms, 'member'),
         (v_p2, v_m, 'member');
  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (v_p, v_m2, 'manage_tasks', v_pm), (v_p, v_ms, 'manage_structure', v_pm);

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values ('pm', v_pm), ('c', v_c), ('m', v_m), ('m2', v_m2), ('m3', v_m3),
                        ('m4', v_m4), ('q', v_q), ('s', v_s), ('d', v_d), ('pend', v_pend),
                        ('ms', v_ms), ('out', v_out),
                        ('p', v_p), ('p2', v_p2);
end $$;

-- ------------------------------------------------------------------ who edits tags

do $$
declare
  v_p  uuid := (select v from fx where k = 'p');
  v_pm uuid := (select v from fx where k = 'pm');
  v_c  uuid := (select v from fx where k = 'c');
  v_m  uuid := (select v from fx where k = 'm');
  v_m2 uuid := (select v from fx where k = 'm2');
  v_m3 uuid := (select v from fx where k = 'm3');
  v_m4 uuid := (select v from fx where k = 'm4');
  v_ms uuid := (select v from fx where k = 'ms');
  n    int;
begin
  perform pg_temp.act_as(v_m);
  perform pg_temp.must_allow('a member adds their own tag',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Figma')$q$, v_p, v_m));
  perform pg_temp.must_be('...and reads it back', pg_temp.tags_of(v_p, v_m) = 1);
  perform pg_temp.must_allow('...and removes it',
    format($q$delete from public.general_member_skills
               where project_id = %L and user_id = %L and tag = 'Figma'$q$, v_p, v_m));
  perform pg_temp.must_be('...which is gone', pg_temp.tags_of(v_p, v_m) = 0);

  perform pg_temp.must_refuse_with('a member cannot add a tag for another member',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Figma')$q$, v_p, v_m3),
    'row-level security');

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('the pm adds a tag for member M3',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Figma')$q$, v_p, v_m3));
  perform pg_temp.act_as(v_c);
  perform pg_temp.must_allow('a coordinator adds a tag for member M3',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Laravel')$q$, v_p, v_m3));
  perform pg_temp.act_as(v_m2);
  perform pg_temp.must_allow('a member granted manage_tasks adds a tag for member M4',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Copywriting')$q$, v_p, v_m4));
  perform pg_temp.must_allow('...and removes another member''s tag',
    format($q$delete from public.general_member_skills
               where project_id = %L and user_id = %L and tag = 'Copywriting'$q$, v_p, v_m4));
  insert into public.general_member_skills (project_id, user_id, tag) values (v_p, v_m4, 'Copywriting');
  perform pg_temp.act_as(v_ms);
  perform pg_temp.must_be('member MS holds manage_structure, not manage_tasks',
    public.general_has(v_p, 'manage_structure') and not public.general_has(v_p, 'manage_tasks'));
  perform pg_temp.must_allow('a member granted manage_structure adds a tag for member M4',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Branding')$q$, v_p, v_m4));
  perform pg_temp.must_allow('...and removes it',
    format($q$delete from public.general_member_skills
               where project_id = %L and user_id = %L and tag = 'Branding'$q$, v_p, v_m4));
  perform pg_temp.must_be('...so M4 is back to one tag', pg_temp.tags_of(v_p, v_m4) = 1);

  perform pg_temp.act_as(v_m);
  delete from public.general_member_skills where project_id = v_p and user_id = v_m3;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a member cannot remove another member''s tag (0 rows)', n = 0);
  perform pg_temp.must_be('...whose two tags stay', pg_temp.tags_of(v_p, v_m3) = 2);
  perform pg_temp.must_refuse_with('nobody edits a tag in place',
    format($q$update public.general_member_skills set tag = 'Sketch'
               where project_id = %L and user_id = %L$q$, v_p, v_m),
    'permission denied');
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ who can't have tags

do $$
declare
  v_p  uuid := (select v from fx where k = 'p');
  v_pm uuid := (select v from fx where k = 'pm');
  v_q  uuid := (select v from fx where k = 'q');
  v_s  uuid := (select v from fx where k = 's');
  v_m  uuid := (select v from fx where k = 'm');
  v_out uuid := (select v from fx where k = 'out');
begin
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('the pm cannot give QA a tag',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Testing')$q$, v_p, v_q),
    'QA and stakeholders don''t take tasks, so they have no skills.');
  perform pg_temp.must_refuse_with('...nor a stakeholder',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Budget')$q$, v_p, v_s),
    'QA and stakeholders don''t take tasks, so they have no skills.');
  perform pg_temp.must_allow('...but gives member M one',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Figma')$q$, v_p, v_m));

  perform pg_temp.act_as(v_q);
  perform pg_temp.must_refuse_with('QA cannot add their own tag',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Testing')$q$, v_p, v_q),
    'QA and stakeholders don''t take tasks, so they have no skills.');
  perform pg_temp.act_as(v_s);
  perform pg_temp.must_refuse_with('a stakeholder cannot add their own tag (row-level security)',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Budget')$q$, v_p, v_s),
    'row-level security');
  perform pg_temp.must_be('...but reads the project''s tags',
    exists (select 1 from public.general_member_skills where project_id = v_p and user_id = v_m));

  -- Somebody off the project learns nothing about who is QA here.
  perform pg_temp.act_as(v_out);
  perform pg_temp.must_refuse_with('an outsider adding a tag for P''s QA gets row-level security, not the QA message',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Testing')$q$, v_p, v_q),
    'row-level security');
  perform pg_temp.must_refuse_with('...and the same for P''s member M',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Testing')$q$, v_p, v_m),
    'row-level security');
  perform pg_temp.must_be('...and reads none of P''s tags',
    not exists (select 1 from public.general_member_skills where project_id = v_p));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ tag rules

do $$
declare
  v_p  uuid := (select v from fx where k = 'p');
  v_m  uuid := (select v from fx where k = 'm');
  v_out uuid := (select v from fx where k = 'out');
  i    int;
begin
  perform pg_temp.act_as(v_m);
  -- M already has Figma; eleven more make twelve.
  for i in 1..11 loop
    insert into public.general_member_skills (project_id, user_id, tag)
    values (v_p, v_m, 'Skill ' || i);
  end loop;
  perform pg_temp.must_be('a member holds 12 tags', pg_temp.tags_of(v_p, v_m) = 12);
  perform pg_temp.must_refuse_with('...and not a 13th',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Skill 12')$q$, v_p, v_m),
    'Up to 12 skills each.');
  perform pg_temp.act_as(v_out);
  perform pg_temp.must_refuse_with('...an outsider trying a 13th gets row-level security, not the count',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Skill 12')$q$, v_p, v_m),
    'row-level security');
  perform pg_temp.act_as(v_m);
  delete from public.general_member_skills where project_id = v_p and user_id = v_m and tag like 'Skill %';

  perform pg_temp.must_refuse_with('"figma" after "Figma" is the same tag',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'figma')$q$, v_p, v_m),
    'duplicate key');
  perform pg_temp.must_refuse_with('"  Figma  " is not normalized',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, '  Sketch  ')$q$, v_p, v_m),
    'check constraint');
  perform pg_temp.must_refuse_with('...nor two inner spaces',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'UI  design')$q$, v_p, v_m),
    'check constraint');
  perform pg_temp.must_refuse_with('...nor an empty tag',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, '')$q$, v_p, v_m),
    'check constraint');
  perform pg_temp.must_refuse_with('...nor 41 characters',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, %L)$q$, v_p, v_m, repeat('x', 41)),
    'check constraint');
  perform pg_temp.must_allow('"UI design" at 40 characters or fewer goes through',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'UI design')$q$, v_p, v_m));
  perform pg_temp.must_allow('...and so does 40 characters',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, %L)$q$, v_p, v_m, repeat('y', 40)));
  delete from public.general_member_skills where project_id = v_p and user_id = v_m and tag = repeat('y', 40);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ role change

do $$
declare
  v_p  uuid := (select v from fx where k = 'p');
  v_m3 uuid := (select v from fx where k = 'm3');
  v_m4 uuid := (select v from fx where k = 'm4');
begin
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('M3 has two tags', pg_temp.tags_of(v_p, v_m3) = 2);
  update public.general_members set role = 'qa' where project_id = v_p and user_id = v_m3;
  perform pg_temp.must_be('...and none once they are QA', pg_temp.tags_of(v_p, v_m3) = 0);

  perform pg_temp.must_be('M4 has a tag', pg_temp.tags_of(v_p, v_m4) = 1);
  update public.general_members set role = 'coordinator' where project_id = v_p and user_id = v_m4;
  perform pg_temp.must_be('...and keeps it as a coordinator', pg_temp.tags_of(v_p, v_m4) = 1);
  update public.general_members set role = 'member' where project_id = v_p and user_id = v_m4;
end $$;

-- ------------------------------------------------------------------ context

-- Project P has QA (Q and now M3), so its QA stage is In progress (1).
do $$
declare
  v_p    uuid := (select v from fx where k = 'p');
  v_pm   uuid := (select v from fx where k = 'pm');
  v_c    uuid := (select v from fx where k = 'c');
  v_m    uuid := (select v from fx where k = 'm');
  v_m2   uuid := (select v from fx where k = 'm2');
  v_m4   uuid := (select v from fx where k = 'm4');
  v_ms   uuid := (select v from fx where k = 'ms');
  v_d    uuid := (select v from fx where k = 'd');
  v_team uuid;
  v_pos  uuid;
  v_pos2 uuid;
  v_open uuid;
  v_done uuid;
  v_arch uuid;
  v_free uuid;
  v_prog uuid;
  v_bug  uuid;
  v_ctx  jsonb;
  v_cm   jsonb;
begin
  perform pg_temp.act_as_service();
  update public.profiles set status = 'rejected' where id = v_d;
  insert into public.general_teams (project_id, name) values (v_p, 'Zz design team') returning id into v_team;
  insert into public.general_team_members (team_id, project_id, user_id) values (v_team, v_p, v_m);
  insert into public.general_positions (project_id, team_id, name) values (v_p, v_team, 'Zz designer')
  returning id into v_pos;
  insert into public.general_positions (project_id, name) values (v_p, 'Zz nobody holds this')
  returning id into v_pos2;
  insert into public.general_position_holders (position_id, project_id, user_id)
  values (v_pos, v_p, v_m);

  perform pg_temp.act_as(v_pm);
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz M open') returning id into v_open;
  insert into public.general_tasks (project_id, title, status) values (v_p, 'Zz M done', 'done')
  returning id into v_done;
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz M archived') returning id into v_arch;
  insert into public.general_tasks (project_id, title, description) values (v_p, 'Zz free', 'Draw it')
  returning id into v_free;
  insert into public.general_tasks (project_id, title, status, stage)
  values (v_p, 'Zz free in progress', 'in_progress', 1) returning id into v_prog;
  insert into public.general_tasks (project_id, title, kind) values (v_p, 'Zz free bug', 'bug')
  returning id into v_bug;
  insert into public.general_task_assignees (task_id, project_id, user_id)
  values (v_open, v_p, v_m), (v_done, v_p, v_m), (v_arch, v_p, v_m);
  perform public.archive_general_task(v_arch, true);

  v_ctx := public.general_assign_context(v_p);

  perform pg_temp.must_be('the candidates are the pm, the coordinator and the active members',
    (select array_agg((c->>'user_id')::uuid order by c->>'user_id')
       from jsonb_array_elements(v_ctx->'candidates') c)
    = (select array_agg(u order by u::text) from unnest(array[v_pm, v_c, v_m, v_m2, v_m4, v_ms]) u));
  perform pg_temp.must_be('...so not QA, the stakeholder, a deactivated or a pending member',
    jsonb_array_length(v_ctx->'candidates') = 6);

  select c into v_cm from jsonb_array_elements(v_ctx->'candidates') c where c->>'user_id' = v_m::text;
  perform pg_temp.must_be('M''s load counts only the open, unarchived task', (v_cm->>'load')::int = 1);
  perform pg_temp.must_be('...M''s name is first and last', v_cm->>'name' = 'Zz Skm');
  perform pg_temp.must_be('...M''s team comes from the team members', v_cm->'teams' = jsonb_build_array(v_team));
  perform pg_temp.must_be('...M holds the designer position', v_cm->'positions' = jsonb_build_array(v_pos));
  perform pg_temp.must_be('...and carries the tags Figma and UI design',
    v_cm->'tags' = '["Figma", "UI design"]'::jsonb);
  perform pg_temp.must_be('the pm, with no team, position or tag, is still a candidate with load 0',
    exists (select 1 from jsonb_array_elements(v_ctx->'candidates') c
             where c->>'user_id' = v_pm::text and (c->>'load')::int = 0
               and c->'teams' = '[]'::jsonb and c->'positions' = '[]'::jsonb and c->'tags' = '[]'::jsonb));

  perform pg_temp.must_be('the positions are only the one somebody holds, with its team',
    v_ctx->'positions' = jsonb_build_array(jsonb_build_object(
      'id', v_pos, 'name', 'Zz designer', 'team_id', v_team, 'team', 'Zz design team')));

  perform pg_temp.must_be('the tasks are the unassigned open ones before QA: the plain task and the bug',
    (select array_agg((t->>'id')::uuid order by t->>'id') from jsonb_array_elements(v_ctx->'tasks') t)
    = (select array_agg(u order by u::text) from unnest(array[v_free, v_bug]) u));
  perform pg_temp.must_be('...so not the unassigned one in In progress, the QA stage',
    not exists (select 1 from jsonb_array_elements(v_ctx->'tasks') t where t->>'id' = v_prog::text));
  perform pg_temp.must_be('...a task carries its title, description and team',
    exists (select 1 from jsonb_array_elements(v_ctx->'tasks') t
             where t->>'id' = v_free::text and t->>'title' = 'Zz free'
               and t->>'description' = 'Draw it' and t->'team_id' = 'null'::jsonb));
  perform pg_temp.must_be('...and nothing is left over', (v_ctx->>'left')::int = 0);

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_be('a coordinator reads the context too',
    jsonb_array_length(public.general_assign_context(v_p)->'candidates') = 6);
  perform pg_temp.act_as(v_m2);
  perform pg_temp.must_be('...and so does a member granted manage_tasks',
    jsonb_array_length(public.general_assign_context(v_p)->'tasks') = 2);

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_refuse_with('a plain member cannot read the context',
    format($q$select public.general_assign_context(%L)$q$, v_p),
    'Only the project manager and coordinators can assign by position.');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...nor the signed-out role',
    not has_function_privilege('anon', 'public.general_assign_context(uuid)', 'execute'));
end $$;

-- Without QA, In progress counts; 61 eligible tasks give 60 and one left.
do $$
declare
  v_p2  uuid := (select v from fx where k = 'p2');
  v_pm  uuid := (select v from fx where k = 'pm');
  v_m   uuid := (select v from fx where k = 'm');
  v_old uuid;
  v_new uuid;
  v_ctx jsonb;
  i     int;
begin
  perform pg_temp.act_as(v_pm);
  for i in 1..60 loop
    insert into public.general_tasks (project_id, title, created_at)
    values (v_p2, 'Zz busy ' || i, now() - make_interval(mins => 100 - i));
  end loop;
  insert into public.general_tasks (project_id, title, status, stage, created_at)
  values (v_p2, 'Zz busy oldest', 'in_progress', 1, now() - interval '1 day') returning id into v_old;
  insert into public.general_tasks (project_id, title, created_at)
  values (v_p2, 'Zz busy newest', now()) returning id into v_new;
  -- One assigned and one done do not count.
  insert into public.general_task_assignees (task_id, project_id, user_id)
  select id, v_p2, v_m from public.general_tasks where project_id = v_p2 and title = 'Zz busy 1';
  insert into public.general_tasks (project_id, title, status) values (v_p2, 'Zz busy done', 'done');

  v_ctx := public.general_assign_context(v_p2);
  perform pg_temp.must_be('61 eligible tasks give 60', jsonb_array_length(v_ctx->'tasks') = 60);
  perform pg_temp.must_be('...and one left', (v_ctx->>'left')::int = 1);
  perform pg_temp.must_be('...oldest first: the In progress task leads, without QA',
    v_ctx->'tasks'->0->>'id' = v_old::text);
  perform pg_temp.must_be('...and the newest is the one left out',
    not exists (select 1 from jsonb_array_elements(v_ctx->'tasks') t where t->>'id' = v_new::text));
  perform pg_temp.must_be('...positions are empty when nobody holds one', v_ctx->'positions' = '[]'::jsonb);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ archived

do $$
declare
  v_p  uuid := (select v from fx where k = 'p');
  v_pm uuid := (select v from fx where k = 'pm');
  v_m  uuid := (select v from fx where k = 'm');
  v_m4 uuid := (select v from fx where k = 'm4');
begin
  perform pg_temp.act_as(v_pm);
  perform public.archive_general_project(v_p, true);
  perform pg_temp.must_refuse_with('nobody adds a tag on an archived project',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Sketch')$q$, v_p, v_m),
    'archived');
  perform pg_temp.must_refuse_with('...nor removes one',
    format($q$delete from public.general_member_skills where project_id = %L and user_id = %L$q$, v_p, v_m),
    'archived');
  perform pg_temp.must_refuse_with('...nor reads the assign context',
    format($q$select public.general_assign_context(%L)$q$, v_p),
    'This project is archived. An Owner can restore it to make changes.');

  perform pg_temp.act_as(v_m4);
  perform pg_temp.must_allow('a member with a tag still leaves the archived project',
    format($q$select public.leave_general_project(%L)$q$, v_p));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and their tag goes with them', pg_temp.tags_of(v_p, v_m4) = 0);

  perform pg_temp.act_as(v_pm);
  perform public.archive_general_project(v_p, false);
  perform pg_temp.must_allow('once restored, a tag goes on again',
    format($q$insert into public.general_member_skills (project_id, user_id, tag)
              values (%L, %L, 'Sketch')$q$, v_p, v_m));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ class board

-- A class board's hidden Files project gives no assign context.
do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  gp uuid;
begin
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-sk', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Zz skills group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values (v_group, v_set, v_a), (v_group, v_set, v_b);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'Zz skills lab', 'activity', 1, 1, 'group', v_set, now() + interval '7 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_group;

  perform pg_temp.act_as(v_a);
  gp := public.ensure_class_board_repo(v_board);
  perform pg_temp.act_as_service();
  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (gp, v_a, 'manage_tasks', v_b)
  on conflict do nothing;
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a class-board member holds manage_tasks there',
    public.general_has(gp, 'manage_tasks'));
  perform pg_temp.must_refuse_with('...but gets no assign context',
    format($q$select public.general_assign_context(%L)$q$, gp),
    'Only the project manager and coordinators can assign by position.');
  perform pg_temp.act_as_service();
end $$;

rollback;
