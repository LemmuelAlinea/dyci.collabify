-- Task routing privacy. Fixtures and assertions always roll back.
begin;
create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.service() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function pg_temp.check(p_label text, p_ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;
select pg_temp.check('routing migration exists', exists (
  select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'general_tasks' and column_name = 'routing_state'));
select pg_temp.check('migration preserves existing task visibility', not exists (
  select 1 from public.general_tasks where routing_state <> 'released'));

do $$
declare
  ids uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  roles text[] := array['pm','coordinator','member','member','qa','qa','stakeholder'];
  p uuid; space uuid; class_id uuid; res uuid; set_id uuid; route_group uuid; class_project uuid; board uuid; files_project uuid; class_task uuid; released uuid; plan uuid; review uuid; bug uuid; team uuid; f uuid; k int; tbl text; n int;
  v_path text; repo_path text; r record;
begin
  for k in 1..7 loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
    values(ids[k],'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'zz-route-'||k||'@example.test','',now(),now());
    insert into public.profiles(id,email,first_name,last_name,role,status,can_manage_projects)
    values(ids[k],'zz-route-'||k||'@example.test','Route',k::text,'member','active',k=1)
    on conflict(id) do update set role='member',status='active',can_manage_projects=excluded.can_manage_projects;
  end loop;
  perform pg_temp.act_as(ids[1]);
  p := (public.create_general_project('Zz routing privacy','')).id;
  select space_id into space from public.general_projects where id=p;
  insert into public.general_tasks(project_id,title) values(p,'Zz released') returning id into released;
  perform pg_temp.check('new-task default stays released until activation',
    (select routing_state='released' from public.general_tasks where id=released));
  perform pg_temp.service();
  for k in 2..7 loop
    insert into public.general_members(project_id,user_id,role) values(p,ids[k],roles[k]::public.general_role);
  end loop;
  insert into public.general_teams(project_id,name) values(p,'Zz routing team') returning id into team;
  insert into public.general_team_members(project_id,team_id,user_id) values(p,team,ids[3]),(p,team,ids[4]);
  update public.general_teams set leader_id=ids[4] where id=team;
  perform pg_temp.act_as(ids[1]);
  insert into public.general_tasks(project_id,title,routing_state,team_id)
    values(p,'Zz private planning','planning',team) returning id into plan;
  insert into public.general_tasks(project_id,title,routing_state,reviewer_id,status,stage)
    values(p,'Zz private review','coordinator_review',ids[2],'in_progress',1) returning id into review;
  perform pg_temp.act_as(ids[5]);
  insert into public.general_tasks(project_id,title,kind,routing_state)
    values(p,'Zz private QA bug','bug','planning') returning id into bug;
  perform pg_temp.service();
  insert into public.general_task_assignees(project_id,task_id,user_id) values(p,plan,ids[3]);
  insert into public.general_task_comments(project_id,task_id,author_id,body) values(p,plan,ids[3],'Zz private comment');
  v_path := p::text||'/'||plan::text||'/private.txt';
  insert into public.general_task_files(project_id,task_id,uploaded_by,file_path,file_name)
    values(p,plan,ids[3],v_path,'private.txt') returning id into f;
  insert into storage.objects(bucket_id,name) values('general-files',v_path);
  repo_path := p::text||'/'||gen_random_uuid()::text||'/unchanged-repo.bin';
  insert into storage.objects(bucket_id,name) values('general-files',repo_path);
  insert into public.general_task_comments(project_id,task_id,author_id,body) values(p,bug,ids[5],'Zz QA private comment');
  insert into public.general_task_logs(project_id,task_id,user_id,minutes,note) values(p,plan,ids[3],12,'Zz private log');
  -- Old notification rows must disappear too if a released task returns to planning.
  insert into public.notifications(user_id,type,general_project_id,general_task_id,title)
    values(ids[3],'general_task_assigned',p,plan,'Zz private old notification');
  insert into public.general_project_visits(user_id,project_id,since,seen_at)
    select unnest(ids),p,now()-interval '1 day',now();
  for k in 1..7 loop
    perform pg_temp.act_as(ids[k]);
    perform pg_temp.check('released task readable for role '||k, exists(select 1 from public.general_tasks where id=released));
    perform pg_temp.check('planning visibility for role '||k,
      exists(select 1 from public.general_tasks where id=plan) = (k<=2));
    perform pg_temp.check('review visibility for role '||k,
      exists(select 1 from public.general_task_overview where id=review) = (k<=2));
    perform pg_temp.check('QA bug exception for role '||k,
      exists(select 1 from public.general_tasks where id=bug) = (k<=2 or k=5));
    foreach tbl in array array['general_task_assignees','general_task_comments','general_task_files','general_task_logs','general_task_events'] loop
      execute format('select count(*) from public.%I where task_id=$1',tbl) into n using plan;
      perform pg_temp.check(tbl||' privacy for role '||k, (n>0)=(k<=2));
    end loop;
    perform pg_temp.check('storage privacy for role '||k,
      exists(select 1 from storage.objects where bucket_id='general-files' and name=v_path)=(k<=2));
    perform pg_temp.check('repository storage is unchanged for role '||k,
      exists(select 1 from storage.objects where bucket_id='general-files' and name=repo_path));
    perform pg_temp.check('QA bug child visibility for role '||k,
      exists(select 1 from public.general_task_comments where task_id=bug)=(k<=2 or k=5));
    perform pg_temp.check('report people has no private activity for role '||k,
      not exists(select 1 from public.general_report_people(space,array[p],now()-interval '1 day',now()+interval '1 day')
        where minutes_logged>0 or comments>0 or files_uploaded>0));
    perform pg_temp.check('catch-up summary is released-only for role '||k,
      (public.general_since_last_visit(p)->>'tasks_added')::int = case when k=1 then 0 else 1 end
      and (public.general_since_last_visit(p)->>'comments_on_mine')::int=0);
    if k in(5,6) then
      perform pg_temp.check('QA queue excludes private review for role '||k,
        (select waiting=0 from public.my_qa_queue() where project_id=p));
    end if;
    perform pg_temp.check('project counts are released-only for role '||k,
      (select task_count=1 and done_count=0 from public.general_project_overview where id=p));
    perform pg_temp.check('report summary is released-only for role '||k,
      (select tasks_total=1 and minutes_in_range=0 and comments_in_range=0 and files_in_range=0
       from public.general_report_summary(space,array[p],now()-interval '1 day',now()+interval '1 day')));
    perform pg_temp.check('report tasks are released-only for role '||k,
      not exists(select 1 from public.general_report_tasks(space,array[p],now()-interval '1 day',now()+interval '1 day') where task_id in(plan,review,bug)));
    perform pg_temp.check('report activity is released-only for role '||k,
      not exists(select 1 from public.general_report_activity(space,array[p],now()-interval '1 day',now()+interval '1 day') where task_id in(plan,review,bug)));
    perform pg_temp.check('report logs are released-only for role '||k,
      not exists(select 1 from public.general_report_time_logs(space,array[p],now()-interval '1 day',now()+interval '1 day') where task_id=plan));
    perform pg_temp.check('progress series is released-only for role '||k,
      not exists(select 1 from public.general_report_progress_series(space,array[p],now()-interval '1 day',now()+interval '1 day') where total_count>1));
    if k>2 then
      perform pg_temp.check('search title stays private for role '||k,
        not exists(select 1 from public.general_tasks where project_id=p and title ilike '%private planning%'));
      perform pg_temp.check('task project helper stays private for role '||k, public.general_task_project(plan) is null);
    end if;
  end loop;
  perform pg_temp.act_as(ids[3]);
  perform pg_temp.check('historical notifications stay private', not exists(
    select 1 from public.notifications where general_task_id=plan));
  perform pg_temp.service();
  perform pg_temp.check('no new notifications for hidden assignee', not exists(
    select 1 from public.notifications where general_task_id=plan and title <> 'Zz private old notification'));
  -- Archivers and old authors lose access after a task returns to planning.
  update public.general_task_files set archived_at=now(),archived_by=ids[3] where id=f;
  update public.general_tasks set archived_at=now(),archived_by=ids[3] where id=plan;
  perform pg_temp.act_as(ids[3]);
  perform pg_temp.check('archive task and file titles stay private', not exists(
    select 1 from public.list_my_archive() where id in(plan,f)));
  perform pg_temp.check('archived task file RPC stays private', not exists(
    select 1 from public.list_archived_general_task_files(p) where id=f));
  perform pg_temp.check('archived storage paths stay private', cardinality(public.archived_general_task_file_objects(array[f]))=0);
  perform pg_temp.service();
  update public.profiles set can_teach=true where id=ids[1];
  update public.profiles set role='student' where id in(ids[3],ids[4]);
  insert into public.teaching_resources(professor_id,kind,title,file_path,file_name)
    values(ids[1],'syllabus','Zz route syllabus','x/route.pdf','route.pdf') returning id into res;
  insert into public.syllabus_weeks(resource_id,week_no,title) values(res,1,'Week 1');
  insert into public.classes(professor_id,name,initial,code,section,year_level,semester,school_year,syllabus_id)
    values(ids[1],'Zz route class','ZZRC','ZZROUTE-01','BSIT 3A','3rd','1st','2026-2027',res) returning id into class_id;
  insert into public.class_members(class_id,student_id,status) values(class_id,ids[3],'active'),(class_id,ids[4],'active');
  insert into public.group_sets(class_id,name,mode) values(class_id,'Zz routing set','manual') returning id into set_id;
  insert into public.groups(set_id,name) values(set_id,'Zz routing group') returning id into route_group;
  insert into public.group_members(group_id,set_id,student_id) values(route_group,set_id,ids[3]),(route_group,set_id,ids[4]);
  insert into public.projects(class_id,created_by,title,type,start_week,end_week,audience,group_set_id,due_at)
    values(class_id,ids[1],'Zz class route project','activity',1,1,'group',set_id,now()+interval '7 days') returning id into class_project;
  perform public.ensure_project_boards(class_project);
  select id into board from public.project_boards where project_id=class_project and public.project_boards.group_id=route_group;
  perform pg_temp.act_as(ids[3]);
  files_project := public.ensure_class_board_repo(board);
  insert into public.general_tasks(project_id,title,routing_state) values(files_project,'Zz class planning','planning') returning id into class_task;
  perform pg_temp.act_as(ids[4]);
  perform pg_temp.check('class-board task reads remain unchanged',exists(select 1 from public.general_task_overview where id=class_task));
  perform pg_temp.check('class-board counts remain unchanged',(select task_count=1 from public.general_project_overview where id=files_project));
  perform pg_temp.service();
end $$;
rollback;
