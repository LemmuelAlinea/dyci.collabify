-- Run after project-member-import.sql and anon-lockdown.sql; every fixture rolls back.
begin;
create function pg_temp.act_as(u uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.service() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.must_be(label text, ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL %', label; end if;
  raise notice 'PASS %', label;
end $$;
create function pg_temp.refuse(label text, statement text, needle text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if position(lower(needle) in lower(sqlerrm)) = 0 then
      raise exception 'FAIL %: wrong refusal: %', label, sqlerrm;
    end if;
    raise notice 'PASS %', label;
    return;
  end;
  raise exception 'FAIL %: accepted', label;
end $$;
-- Independent serialization of the frontend snapshot contract.
create function pg_temp.snapshot(p uuid, users uuid[]) returns jsonb language sql as $$
select jsonb_build_object(
  'members', coalesce((select jsonb_agg(jsonb_build_object(
    'user_id', m.user_id, 'role', m.role,
    'team_ids', coalesce((select jsonb_agg(t.team_id order by t.team_id::text collate "C") from public.general_team_members t where t.project_id=p and t.user_id=m.user_id), '[]'),
    'position_ids', coalesce((select jsonb_agg(h.position_id order by h.position_id::text collate "C") from public.general_position_holders h where h.project_id=p and h.user_id=m.user_id), '[]'),
    'skills', coalesce((select jsonb_object_agg(s.tag, true) from public.general_member_skills s where s.project_id=p and s.user_id=m.user_id), '{}')
  ) order by m.user_id::text collate "C") from public.general_members m where m.project_id=p and m.user_id=any(users)), '[]'),
  'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'leader_id', t.leader_id, 'archived', t.archived_at is not null) order by t.id::text collate "C") from public.general_teams t where t.project_id=p), '[]'),
  'positions', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'team_id', t.team_id) order by t.id::text collate "C") from public.general_positions t where t.project_id=p), '[]')
);
$$;
create function pg_temp.row_for(u uuid, teams jsonb default null, positions jsonb default null, skills jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('user_id', u, 'teams', teams, 'positions', positions, 'skills', skills);
$$;

create function pg_temp.fail_late() returns trigger language plpgsql as $$
begin
  if new.tag='Fail later' then
    if not exists(select 1 from public.general_teams where project_id=new.project_id and name='Rollback team') then
      raise exception 'Fixture did not reach the earlier insert';
    end if;
    raise exception 'Deliberate late write failure';
  end if;
  return new;
end $$;
create trigger import_test_late before insert on public.general_member_skills for each row execute function pg_temp.fail_late();

do $$
declare
  pm uuid := gen_random_uuid(); c uuid := gen_random_uuid(); m uuid := gen_random_uuid();
  q uuid := gen_random_uuid(); s uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  p uuid; p2 uuid; resource_id uuid; class_id uuid; class_project uuid; board uuid; files_project uuid; t uuid; pos uuid; before jsonb; rows jsonb; got jsonb; u uuid;
begin
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    select x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      x::text || '@example.test', '', now(), now() from unnest(array[pm,c,m,q,s,outsider]) x;
  insert into public.profiles(id,email,first_name,last_name,role,status,can_manage_projects)
    select x, x::text || '@example.test', 'Import', x::text, 'member', 'active', x=pm
    from unnest(array[pm,c,m,q,s,outsider]) x
    on conflict(id) do update set role='member', status='active', can_manage_projects=excluded.can_manage_projects;
  perform pg_temp.act_as(pm);
  p := (public.create_general_project('Import test', '')).id;
  p2 := (public.create_general_project('Other import test', '')).id;
  perform pg_temp.service();
  insert into public.general_members(project_id,user_id,role) values
    (p,c,'coordinator'),(p,m,'member'),(p,q,'qa'),(p,s,'stakeholder');
  insert into public.general_grants(project_id,user_id,permission,granted_by) values(p,m,'manage_structure',pm);
  before := pg_temp.snapshot(p,array[m]);
  rows := jsonb_build_array(pg_temp.row_for(m, '[" Dev ","dev"]', '[{"team":"Dev","name":"Builder"},{"team":"","name":"Adviser"}]', '["  TypeScript  ","typescript","設計"]'));
  perform pg_temp.act_as(pm);
  got := public.apply_general_member_import(p,'add',rows,before);
  perform pg_temp.must_be('Add creates one team, two scoped positions and changes one member', got='{"teams":1,"positions":2,"members":1}'::jsonb);
  perform pg_temp.must_be('skills normalize and deduplicate', (select count(*)=2 and bool_or(tag='TypeScript') from public.general_member_skills where project_id=p and user_id=m));
  perform pg_temp.must_be('exact retry returns zero', public.apply_general_member_import(p,'add',rows,before)='{"teams":0,"positions":0,"members":0}'::jsonb);
  select id into t from public.general_teams where project_id=p and name='Dev';
  select id into pos from public.general_positions where project_id=p and name='Builder';
  perform public.set_general_team_leader(t,m);
  before := pg_temp.snapshot(p,array[m]);
  perform pg_temp.must_be('Replace blanks leave everything unchanged', public.apply_general_member_import(p,'replace',jsonb_build_array(pg_temp.row_for(m)),before)='{"teams":0,"positions":0,"members":0}'::jsonb);
  perform pg_temp.refuse('leader cannot lose team',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,'[]','[]')),before),'leader');
  perform public.set_general_team_leader(t,null);
  before := pg_temp.snapshot(p,array[m]);
  perform pg_temp.refuse('unchanged scoped position requires team',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,'[]')),before),'position');
  perform pg_temp.refuse('Add cannot remove current values',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,'[]','[]')),before),'Add');
  perform pg_temp.refuse('13 skills refused',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,null,null,(select jsonb_agg('tag'||n) from generate_series(1,13)n))),before),'12');
  foreach u in array array[m,q,s,outsider] loop
    perform pg_temp.act_as(u);
    perform pg_temp.refuse('only PM/coordinator imports',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,rows,before),'project manager');
  end loop;
  perform pg_temp.act_as(c);
  perform pg_temp.must_be('coordinator can replace skills', public.apply_general_member_import(p,'replace',jsonb_build_array(pg_temp.row_for(m,null,null,'["SQL"]')),before)='{"teams":0,"positions":0,"members":1}'::jsonb);
  perform pg_temp.refuse('stale member snapshot refuses',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,null,null,'["New"]')),before),'review');
  perform pg_temp.must_be('absent members unchanged', (select count(*)=0 from public.general_member_skills where project_id=p and user_id=c));
  before := pg_temp.snapshot(p,array[m]);
  insert into public.general_teams(project_id,name) values(p,'Concurrent');
  perform pg_temp.refuse('new catalog row invalidates review',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,null,null,'["New"]')),before),'review');
  before := pg_temp.snapshot(p,array[q]);
  perform pg_temp.refuse('QA skills refused',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(q,null,null,'["SQL"]')),before),'skills');
  before := pg_temp.snapshot(p,array[s]);
  perform pg_temp.refuse('stakeholder skills refused',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(s,null,null,'["SQL"]')),before),'skills');
  before := pg_temp.snapshot(p,array[m]);
  perform pg_temp.refuse('missing member refused',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(outsider)),before),'member');
  perform pg_temp.refuse('foreign project snapshot refused',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p2,jsonb_build_array(pg_temp.row_for(m)),before),'member');
  perform pg_temp.refuse('ID-bearing team object refused',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,jsonb_build_array(jsonb_build_object('id',t)))),before),'team');
  perform pg_temp.must_be('Replace removes holders before memberships', public.apply_general_member_import(p,'replace',jsonb_build_array(pg_temp.row_for(m,'[]','[]','[]')),before)='{"teams":0,"positions":0,"members":1}'::jsonb);
  perform pg_temp.must_be('catalogs retained', exists(select 1 from public.general_positions where id=pos) and exists(select 1 from public.general_teams where id=t));
  before := pg_temp.snapshot(p,array[m]);
  perform pg_temp.refuse('later failure rolls back earlier writes',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,
    jsonb_build_array(pg_temp.row_for(m,'["Rollback team"]','[{"team":"Rollback team","name":"Rollback position"}]','["Fail later"]')),before),'Deliberate late write failure');
  perform pg_temp.must_be('all structure restored after late insert failure', pg_temp.snapshot(p,array[m])=before);
  perform pg_temp.refuse('empty batch refused',format('select public.apply_general_member_import(%L,''add'',''[]'',%L)',p,before),'100');
  perform pg_temp.refuse('duplicate users refused',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m),pg_temp.row_for(m)),before),'duplicate');
  perform pg_temp.refuse('missing fields refused',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,jsonb_build_array(jsonb_build_object('user_id',m)),before),'fields');
  perform pg_temp.refuse('missing expected member refused',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m)),jsonb_set(before,'{members}','[]')),'review');
  perform pg_temp.refuse('duplicate snapshot members refused',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m)),jsonb_set(before,'{members}',(before->'members')||(before->'members'))),'review');
  perform pg_temp.refuse('incomplete snapshot refused even for achieved result',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,'[]','[]','[]')),jsonb_set(before,'{members,0}',(before#>'{members,0}')-'skills')),'review');
  perform pg_temp.refuse('foreign snapshot relationship refused',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,null,null,'["Different"]')),jsonb_set(before,'{members,0,team_ids}',jsonb_build_array(gen_random_uuid()))),'review');
  perform pg_temp.refuse('long name refused',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,jsonb_build_array(repeat('x',81)))),before),'80');
  perform pg_temp.refuse('long skill refused',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,null,null,jsonb_build_array(repeat('x',41)))),before),'40');
  update public.general_teams set archived_at=now() where id=t;
  before := pg_temp.snapshot(p,array[m]);
  perform pg_temp.refuse('archived team refused',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,jsonb_build_array(pg_temp.row_for(m,'["Dev"]')),before),'archived');
  perform pg_temp.must_be('null fields preserve archived catalog', public.apply_general_member_import(p,'replace',jsonb_build_array(pg_temp.row_for(m)),before)='{"teams":0,"positions":0,"members":0}'::jsonb);
  update public.general_teams set archived_at=null where id=t;
  before := pg_temp.snapshot(p,array[m]);
  perform public.apply_general_member_import(p,'add',jsonb_build_array(pg_temp.row_for(m,'["Dev"]','[{"team":"Dev","name":"Builder"}]')),before);
  update public.general_teams set archived_at=now() where id=t;
  before := pg_temp.snapshot(p,array[m]);
  perform pg_temp.must_be('Add retains reviewed archived membership and position',public.apply_general_member_import(p,'add',
    jsonb_build_array(pg_temp.row_for(m,'["Dev","Active new"]','[{"team":"Dev","name":"Builder"}]')),before)='{"teams":1,"positions":0,"members":1}'::jsonb);
  before := pg_temp.snapshot(p,array[m]);
  perform pg_temp.refuse('new position on retained archived team refused',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,
    jsonb_build_array(pg_temp.row_for(m,'["Dev","Active new"]','[{"team":"Dev","name":"New archived position"}]')),before),'archived');
  update public.general_teams set archived_at=null where id=t;
  before := pg_temp.snapshot(p,array[m]);
  rows := jsonb_build_array(pg_temp.row_for(m,'["Dev"]','[{"team":"Dev","name":"Builder"}]','["SQL"]'));
  perform pg_temp.must_be('reuse existing scoped names',public.apply_general_member_import(p,'replace',rows,before)='{"teams":0,"positions":0,"members":1}'::jsonb);
  perform pg_temp.must_be('Replace exact retry',public.apply_general_member_import(p,'replace',rows,before)='{"teams":0,"positions":0,"members":0}'::jsonb);
  before := pg_temp.snapshot(p,array[c,m]);
  rows := jsonb_build_array(
    pg_temp.row_for(m,'["Shared","Other scope"]','[{"team":"Shared","name":"Builder"},{"team":"Other scope","name":"Builder"}]'),
    pg_temp.row_for(c,'[" shared "]','[{"team":"SHARED","name":"builder"}]'));
  perform pg_temp.must_be('two members share creations and same names remain scoped',public.apply_general_member_import(p,'replace',rows,before)='{"teams":2,"positions":2,"members":2}'::jsonb);
  perform pg_temp.must_be('multi-member snapshot exact retry',public.apply_general_member_import(p,'replace',rows,before)='{"teams":0,"positions":0,"members":0}'::jsonb);
  perform pg_temp.must_be('roles and grants remain unchanged',
    (select role='member' from public.general_members where project_id=p and user_id=m)
    and (select role='coordinator' from public.general_members where project_id=p and user_id=c)
    and exists(select 1 from public.general_grants where project_id=p and user_id=m and permission='manage_structure'));
  before := pg_temp.snapshot(p,array[m]);
  rows := jsonb_build_array(pg_temp.row_for(m,null,null,(select jsonb_agg('tag'||n) from generate_series(1,12)n)));
  perform pg_temp.must_be('12 final skills allowed',public.apply_general_member_import(p,'replace',rows,before)='{"teams":0,"positions":0,"members":1}'::jsonb);
  perform pg_temp.must_be('12-skill exact retry skips inserts',public.apply_general_member_import(p,'replace',rows,before)='{"teams":0,"positions":0,"members":0}'::jsonb);
  before := pg_temp.snapshot(p,array[m]);
  insert into public.general_positions(project_id,team_id,name) values(p,t,'Builder');
  perform pg_temp.refuse('ambiguous scoped positions refused',format('select public.apply_general_member_import(%L,''replace'',%L,%L)',p,
    jsonb_build_array(pg_temp.row_for(m,'["Dev"]','[{"team":"Dev","name":"Builder"}]')),pg_temp.snapshot(p,array[m])),'More than one position');
  perform pg_temp.service();
  update public.general_members set role='member'  where project_id=p and user_id=c;
  perform pg_temp.act_as(c);
  perform pg_temp.refuse('revoked coordinator refused',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,rows,before),'project manager');
  perform pg_temp.service();
  update public.general_projects set archived_at=now() where id=p;
  perform pg_temp.act_as(pm);
  perform pg_temp.refuse('archived project refused',format('select public.apply_general_member_import(%L,''add'',%L,%L)',p,rows,before),'archived');
  perform pg_temp.service();
  update public.profiles set can_teach=true where id=pm;
  update public.profiles set role='student' where id=m;
  insert into public.teaching_resources(professor_id,kind,title,file_path,file_name)
    values(pm,'syllabus','Import test syllabus','x/import.pdf','import.pdf') returning id into resource_id;
  insert into public.syllabus_weeks(resource_id,week_no,title) values(resource_id,1,'Week 1');
  insert into public.classes(professor_id,name,initial,code,section,year_level,semester,school_year,syllabus_id)
    values(pm,'Import test class','IMPT','ZZIMPORT-01','BSIT 3A','3rd','1st','2026-2027',resource_id) returning id into class_id;
  insert into public.class_members(class_id,student_id,status) values(class_id,m,'active');
  insert into public.projects(class_id,created_by,title,type,start_week,end_week,audience,due_at)
    values(class_id,pm,'Import class project','activity',1,1,'individual',now()+interval '7 days') returning id into class_project;
  perform public.ensure_project_boards(class_project);
  select b.id into board from public.project_boards b where b.project_id=class_project and b.student_id=m;
  perform pg_temp.act_as(m);
  files_project := public.ensure_class_board_repo(board);
  perform pg_temp.refuse('class board refused',format('select public.apply_general_member_import(%L,''add'',%L,%L)',files_project,jsonb_build_array(pg_temp.row_for(m)),before),'work project');
  perform pg_temp.service();
  perform pg_temp.must_be('anonymous cannot execute import',not has_function_privilege('anon','public.apply_general_member_import(uuid,text,jsonb,jsonb)','execute'));
  perform pg_temp.must_be('service role not granted import',not has_function_privilege('service_role','public.apply_general_member_import(uuid,text,jsonb,jsonb)','execute'));
end $$;
rollback;
