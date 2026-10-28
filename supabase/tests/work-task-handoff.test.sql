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
  perform pg_temp.service();
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
    select recipient,'general_task_assigned',p,task,'Zz private old notification'
      from unnest(ids) recipient cross join unnest(array[plan,review,bug,released]) task;
  insert into public.notifications(user_id,type,general_project_id,title)
    select recipient,'general_task_assigned',p,'Zz project notification' from unnest(ids) recipient;
  insert into public.general_project_visits(user_id,project_id,since,seen_at)
    select unnest(ids),p,now()-interval '1 day',now();
  for k in 1..7 loop
    perform pg_temp.act_as(ids[k]);
    perform pg_temp.check('planning/review notifications hidden for every role '||k,
      not exists(select 1 from public.notifications where general_task_id in(plan,review,bug)));
    perform pg_temp.check('released task notifications remain visible for role '||k,
      exists(select 1 from public.notifications where general_task_id=released));
    perform pg_temp.check('project notifications remain visible for role '||k,
      exists(select 1 from public.notifications where general_project_id=p and general_task_id is null));
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
  insert into public.general_task_assignees(project_id,task_id,user_id) values(files_project,class_task,ids[3]);
  perform pg_temp.check('class-board member still claims a task',exists(
    select 1 from public.general_task_assignees where task_id=class_task and user_id=ids[3]));
  perform pg_temp.service();
  insert into public.notifications(user_id,type,general_project_id,general_task_id,title)
    values(ids[4],'general_task_assigned',files_project,class_task,'Zz class task notification');
  perform pg_temp.act_as(ids[4]);
  perform pg_temp.check('class-board task notifications remain unchanged',exists(
    select 1 from public.notifications where general_task_id=class_task));
  perform pg_temp.check('class-board task reads remain unchanged',exists(select 1 from public.general_task_overview where id=class_task));
  perform pg_temp.check('class-board counts remain unchanged',(select task_count=1 from public.general_project_overview where id=files_project));
  perform pg_temp.service();
end $$;
create or replace function pg_temp.refuse(p_label text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when insufficient_privilege or check_violation or invalid_parameter_value or serialization_failure then
    raise notice 'PASS %', p_label;
    return;
  end;
  raise exception 'FAIL %: accepted', p_label;
end $$;
create or replace function pg_temp.route_rows(p_tasks uuid[], p_teams uuid[] default null) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id',t.id,'updated_at',t.updated_at,'team_id',p_teams[x.n]) order by x.n)
  from unnest(p_tasks) with ordinality x(id,n) join public.general_tasks t on t.id=x.id;
$$;
do $$
declare
  u uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  p uuid; teams uuid[] := '{}'; tasks uuid[] := '{}'; v uuid; k int; rows jsonb; before_events int; before_notices int;
  roles text[] := array['pm','coordinator','member','member','member','qa','stakeholder','coordinator'];
begin
  for k in 1..8 loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(u[k],'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-handoff-'||k||'@example.test','',now(),now());
    insert into public.profiles(id,email,first_name,last_name,role,status,can_manage_projects)
      values(u[k],'zz-handoff-'||k||'@example.test','Handoff',k::text,'member','active',k=1)
      on conflict(id) do update set role='member',status='active',can_manage_projects=excluded.can_manage_projects;
  end loop;
  perform pg_temp.act_as(u[1]);
  p := (public.create_general_project('Zz atomic handoff','')).id;
  perform pg_temp.service();
  for k in 2..8 loop
    insert into public.general_members(project_id,user_id,role) values(p,u[k],roles[k]::public.general_role);
  end loop;
  for k in 1..3 loop
    insert into public.general_teams(project_id,name) values(p,'Zz handoff team '||k) returning id into v;
    teams := array_append(teams,v);
  end loop;
  insert into public.general_team_members(project_id,team_id,user_id)
    values(p,teams[1],u[3]),(p,teams[1],u[5]),(p,teams[2],u[4]);
  update public.general_teams set leader_id=u[3] where id=teams[1];
  update public.general_teams set leader_id=u[4] where id=teams[2];
  for k in 1..5 loop
    insert into public.general_tasks(project_id,title,routing_state,created_by)
      values(p,'Zz handoff task '||k,'planning',u[1]) returning id into v;
    tasks := array_append(tasks,v);
  end loop;
  perform pg_temp.act_as(u[1]);
  rows := pg_temp.route_rows(array[tasks[1]],array[teams[1]]);
  perform pg_temp.check('PM sends directly to team',public.send_work_tasks_to_teams(p,rows)=1);
  perform pg_temp.refuse('consumed timestamp cannot be reused',format('select public.send_work_tasks_to_teams(%L,%L,%L)',p,rows,'Repeat'));
  perform pg_temp.check('direct send stamps route and team',(select routing_state='released' and team_id=teams[1] and sent_at is not null from public.general_tasks where id=tasks[1]));
  perform pg_temp.service();
  perform pg_temp.check('first release notifies only receiving lead',(select array_agg(user_id)=array[u[3]] from public.notifications where general_task_id=tasks[1]));
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('PM sends to selected coordinator',public.send_work_tasks_to_coordinator(p,pg_temp.route_rows(array[tasks[2]]),u[2])=1);
  perform pg_temp.check('review event records reviewer',exists(select 1 from public.general_task_events where task_id=tasks[2] and kind='sent_to_coordinator' and detail->>'reviewer_id'=u[2]::text));
  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('selected coordinator sees review bell',exists(select 1 from public.notifications where general_task_id=tasks[2]));
  perform pg_temp.act_as(u[8]);
  perform pg_temp.check('other coordinator has no review bell',not exists(select 1 from public.notifications where general_task_id=tasks[2]));
  perform pg_temp.refuse('other coordinator cannot return review',format('select public.return_work_task(%L,%L)',tasks[2],'not mine'));
  perform pg_temp.service();
  update public.profiles set status='pending' where id=u[2];
  perform pg_temp.act_as(u[2]);
  perform pg_temp.refuse('inactive reviewer cannot return',format('select public.return_work_task(%L,%L)',tasks[2],'Not active'));
  perform pg_temp.service();
  update public.profiles set status='active' where id=u[2];
  perform pg_temp.act_as(u[2]);
  perform pg_temp.refuse('return requires reason',format('select public.return_work_task(%L,%L)',tasks[2],'  '));
  perform public.return_work_task(tasks[2],'Clarify scope');
  perform pg_temp.check('coordinator returns to planning',(select routing_state='planning' and reviewer_id is null and sent_at is null from public.general_tasks where id=tasks[2]));
  perform pg_temp.act_as(u[1]);
  perform public.send_work_tasks_to_coordinator(p,pg_temp.route_rows(array[tasks[2]]),u[2]);
  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('coordinator releases reviewed work',public.send_work_tasks_to_teams(p,pg_temp.route_rows(array[tasks[2]],array[teams[2]]))=1);
  perform pg_temp.act_as(u[4]);
  perform public.return_work_task(tasks[2],'No capacity');
  perform pg_temp.check('lead sees own return receipt',exists(select 1 from public.work_task_return_receipts(p) where task_id=tasks[2] and reason='No capacity' and returned_at is not null));
  perform pg_temp.act_as(u[3]);
  perform pg_temp.check('other lead cannot see return receipt',not exists(select 1 from public.work_task_return_receipts(p)));
  perform pg_temp.act_as(u[5]);
  perform pg_temp.check('member cannot see another return receipt',not exists(select 1 from public.work_task_return_receipts(p)));
  perform pg_temp.act_as(u[4]);
  perform pg_temp.check('returned task leaves lead reads',not exists(select 1 from public.general_tasks where id=tasks[2]));
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('PM sees return notification',exists(select 1 from public.notifications where general_task_id=tasks[2] and preview='No capacity'));
  perform pg_temp.check('return event records lead reason',exists(select 1 from public.general_task_events where task_id=tasks[2] and kind='returned' and actor_id=u[4] and detail->>'reason'='No capacity'));
  perform pg_temp.check('returned task can be resent',public.send_work_tasks_to_teams(p,pg_temp.route_rows(array[tasks[2]],array[teams[1]]))=1);
  perform pg_temp.check('mixed team batch releases every row',public.send_work_tasks_to_teams(p,pg_temp.route_rows(array[tasks[3],tasks[4]],array[teams[1],teams[2]]))=2);
  perform pg_temp.check('send event records destination',exists(select 1 from public.general_task_events where task_id=tasks[3] and kind='sent_to_team' and detail->>'new_team_id'=teams[1]::text));
  perform pg_temp.check('mixed team destinations preserved',(select team_id=teams[1] from public.general_tasks where id=tasks[3]) and (select team_id=teams[2] from public.general_tasks where id=tasks[4]));
  select count(*) into before_events from public.general_task_events where project_id=p;
  perform pg_temp.service();
  select count(*) into before_notices from public.notifications where general_project_id=p;
  perform pg_temp.act_as(u[1]);
  rows := pg_temp.route_rows(array[tasks[5]],array[teams[1]]);
  perform pg_temp.refuse('duplicate ids refuse entire batch',format('select public.send_work_tasks_to_teams(%L,%L)',p,rows||rows));
  perform pg_temp.refuse('stale token refuses entire batch',format('select public.send_work_tasks_to_teams(%L,%L,%L)',p,
    pg_temp.route_rows(array[tasks[5]],array[teams[1]])||jsonb_build_array(jsonb_build_object('id',tasks[3],'team_id',teams[2],'updated_at',now()-interval '1 day')),'Move'));
  perform pg_temp.check('failed batches leave no events',(select count(*)=before_events from public.general_task_events where project_id=p));
  perform pg_temp.service();
  perform pg_temp.check('failed batches leave no notifications',(select count(*)=before_notices from public.notifications where general_project_id=p));
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('invalid batch leaves planning untouched',(select routing_state='planning' from public.general_tasks where id=tasks[5]));
  perform pg_temp.refuse('leaderless destination refused',format('select public.send_work_tasks_to_teams(%L,%L)',p,pg_temp.route_rows(array[tasks[5]],array[teams[3]])));
  perform pg_temp.refuse('missing token refused',format('select public.send_work_tasks_to_teams(%L,%L)',p,jsonb_build_array(jsonb_build_object('id',tasks[5],'team_id',teams[1]))));
  perform pg_temp.refuse('empty batch refused',format('select public.send_work_tasks_to_teams(%L,%L)',p,'[]'));
  perform pg_temp.refuse('non-coordinator reviewer refused',format('select public.send_work_tasks_to_coordinator(%L,%L,%L)',p,pg_temp.route_rows(array[tasks[5]]),u[3]));
  perform pg_temp.refuse('coordinator duplicate refused',format('select public.send_work_tasks_to_coordinator(%L,%L,%L)',p,rows||rows,u[2]));
  perform pg_temp.refuse('released task cannot go to review',format('select public.send_work_tasks_to_coordinator(%L,%L,%L)',p,pg_temp.route_rows(array[tasks[1]]),u[2]));
  perform pg_temp.refuse('direct routing state refused',format('update public.general_tasks set routing_state=%L where id=%L','planning',tasks[1]));
  perform pg_temp.refuse('direct reviewer refused',format('update public.general_tasks set reviewer_id=%L where id=%L',u[2],tasks[5]));
  perform pg_temp.refuse('direct sent timestamp refused',format('update public.general_tasks set sent_at=now() where id=%L',tasks[5]));
  perform pg_temp.refuse('direct released team change refused',format('update public.general_tasks set team_id=%L where id=%L',teams[2],tasks[1]));
  update public.general_tasks set team_id=teams[1] where id=tasks[5];
  perform pg_temp.check('planning team edit does not release',(select routing_state='planning' from public.general_tasks where id=tasks[5]));
  insert into public.general_task_assignees(project_id,task_id,user_id) values(p,tasks[1],u[5]);
  insert into public.general_task_comments(project_id,task_id,body) values(p,tasks[1],'Keep discussion');
  perform pg_temp.act_as(u[5]);
  insert into public.general_task_logs(project_id,task_id,minutes,note) values(p,tasks[1],15,'Keep work');
  perform pg_temp.act_as(u[1]);
  insert into public.general_task_files(project_id,task_id,file_path,file_name) values(p,tasks[1],p::text||'/'||tasks[1]::text||'/keep.txt','keep.txt');
  update public.general_projects set stages=array['To do','Building','Testing','Done'] where id=p;
  update public.general_tasks set stage=1,status='in_progress' where id=tasks[1];
  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('lead cannot return assigned task',format('select public.return_work_task(%L,%L)',tasks[1],'Cannot take'));
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('reroute requires reason',format('select public.send_work_tasks_to_teams(%L,%L)',p,pg_temp.route_rows(array[tasks[1]],array[teams[2]])));
  perform public.send_work_tasks_to_teams(p,pg_temp.route_rows(array[tasks[1]],array[teams[2]]),'Capacity change');
  perform pg_temp.check('reroute clears holders',not exists(select 1 from public.general_task_assignees where task_id=tasks[1]));
  perform pg_temp.check('reroute retains work',(select stage=1 and status='in_progress' from public.general_tasks where id=tasks[1])
    and exists(select 1 from public.general_task_comments where task_id=tasks[1])
    and exists(select 1 from public.general_task_logs where task_id=tasks[1])
    and exists(select 1 from public.general_task_files where task_id=tasks[1]));
  perform pg_temp.check('reroute event captures actor teams reason and holders',exists(select 1 from public.general_task_events where task_id=tasks[1] and kind='rerouted' and actor_id=u[1]
    and detail->>'old_team_id'=teams[1]::text and detail->>'new_team_id'=teams[2]::text and detail->>'reason'='Capacity change'
    and detail->'former_holder_ids'=to_jsonb(array[u[5]])));
  perform pg_temp.service();
  perform pg_temp.check('reroute notifies old and new team only',(select array_agg(distinct user_id order by user_id) from public.notifications where general_task_id=tasks[1] and preview='Capacity change')=(select array_agg(x order by x) from unnest(array[u[3],u[4],u[5]]) x));
  perform pg_temp.act_as(u[1]);
  update public.general_tasks set stage=2 where id=tasks[1];
  perform pg_temp.refuse('QA task refuses reroute',format('select public.send_work_tasks_to_teams(%L,%L,%L)',p,pg_temp.route_rows(array[tasks[1]],array[teams[1]]),'Move'));
  perform pg_temp.act_as(u[4]);
  perform pg_temp.refuse('lead cannot return QA work to bypass reroute gate',format('select public.return_work_task(%L,%L)',tasks[1],'Bypass'));
  perform pg_temp.act_as(u[1]);
  update public.general_tasks set status='done' where id=tasks[1];
  perform pg_temp.refuse('done task refuses reroute',format('select public.send_work_tasks_to_teams(%L,%L,%L)',p,pg_temp.route_rows(array[tasks[1]],array[teams[1]]),'Move'));
  perform pg_temp.service();
  update public.general_projects set archived_at=now() where id=p;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('archived project refuses send',format('select public.send_work_tasks_to_teams(%L,%L)',p,pg_temp.route_rows(array[tasks[5]],array[teams[1]])));
  perform pg_temp.refuse('archived project refuses review',format('select public.send_work_tasks_to_coordinator(%L,%L,%L)',p,pg_temp.route_rows(array[tasks[5]]),u[2]));
  perform pg_temp.service();
  update public.general_projects set archived_at=null where id=p;
  update public.profiles set status='pending' where id=u[4];
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('inactive lead refuses send',format('select public.send_work_tasks_to_teams(%L,%L)',p,pg_temp.route_rows(array[tasks[5]],array[teams[2]])));
  for k in 3..7 loop
    perform pg_temp.act_as(u[k]);
    perform pg_temp.refuse('non-planner cannot send role '||k,format('select public.send_work_tasks_to_teams(%L,%L)',p,rows));
    perform pg_temp.refuse('non-PM cannot send review role '||k,format('select public.send_work_tasks_to_coordinator(%L,%L,%L)',p,rows,u[2]));
  end loop;
  perform pg_temp.service();
end $$;

do $$
declare
  u uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  roles text[] := array['pm','coordinator','member','member','member','qa','stakeholder'];
  p uuid; team uuid; other_team uuid; task uuid; plan uuid; k int;
begin
  for k in 1..7 loop
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
      values(u[k],'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-create-'||k||'@example.test','',now(),now());
    insert into public.profiles(id,email,first_name,last_name,role,status,can_manage_projects)
      values(u[k],'zz-create-'||k||'@example.test','Creation',k::text,'member','active',k=1)
      on conflict(id) do update set role='member',status='active',can_manage_projects=excluded.can_manage_projects;
  end loop;
  perform pg_temp.act_as(u[1]);
  p := (public.create_general_project('Zz creation rules','')).id;
  perform pg_temp.service();
  for k in 2..7 loop
    insert into public.general_members(project_id,user_id,role) values(p,u[k],roles[k]::public.general_role);
  end loop;
  insert into public.general_teams(project_id,name) values(p,'Zz creation team') returning id into team;
  insert into public.general_team_members(project_id,team_id,user_id) values(p,team,u[3]),(p,team,u[4]);
  update public.general_teams set leader_id=u[3] where id=team;
  insert into public.general_teams(project_id,name) values(p,'Zz other led team') returning id into other_team;
  insert into public.general_team_members(project_id,team_id,user_id) values(p,other_team,u[3]),(p,other_team,u[5]);
  update public.general_teams set leader_id=u[3] where id=other_team;
  for k in 1..2 loop
    perform pg_temp.act_as(u[k]);
    insert into public.general_tasks(project_id,title,routing_state) values(p,'Zz planner task','planning') returning id into plan;
    perform pg_temp.check('planner creates regular task '||k,plan is not null);
    perform pg_temp.refuse('planner cannot assign private task '||k,format(
      'insert into public.general_task_assignees(project_id,task_id,user_id) values(%L,%L,%L)',p,plan,u[4]));
  end loop;
  for k in 3..7 loop
    perform pg_temp.act_as(u[k]);
    perform pg_temp.refuse('non-planner cannot create regular task '||k,format(
      'insert into public.general_tasks(project_id,title) values(%L,%L)',p,'Zz forbidden regular'));
  end loop;
  perform pg_temp.service();
  insert into public.general_grants(project_id,user_id,permission,granted_by) values(p,u[5],'manage_tasks',u[1]);
  perform pg_temp.act_as(u[5]);
  perform pg_temp.refuse('grant cannot permit regular creation',format(
    'insert into public.general_tasks(project_id,title) values(%L,%L)',p,'Zz granted regular'));
  perform pg_temp.act_as(u[6]);
  insert into public.general_tasks(project_id,title,kind,routing_state) values(p,'Zz QA bug','bug','planning');
  perform pg_temp.check('QA creates private bug',exists(select 1 from public.general_tasks where project_id=p and kind='bug'));
  perform pg_temp.act_as(u[1]);
  insert into public.general_tasks(project_id,title,team_id) values(p,'Zz released assignment',team) returning id into task;
  for k in 1..2 loop
    perform pg_temp.act_as(u[k]);
    perform pg_temp.check('planner context includes private tasks '||k,
      jsonb_array_length(public.general_route_context(p)->'tasks')=3);
    perform pg_temp.check('planner context excludes released tasks '||k,
      not (public.general_route_context(p)->'tasks' @> jsonb_build_array(jsonb_build_object('id',task))));
  end loop;
  for k in 4..7 loop
    perform pg_temp.act_as(u[k]);
    perform pg_temp.refuse('non-planner routing context refused '||k,format('select public.general_route_context(%L)',p));
    perform pg_temp.refuse('non-lead assignment context refused '||k,format('select public.general_lead_assign_context(%L)',p));
  end loop;
  perform pg_temp.act_as(u[3]);
  perform pg_temp.check('lead context includes only incoming task',
    jsonb_array_length(public.general_lead_assign_context(p)->'tasks')=1
    and public.general_lead_assign_context(p)->'tasks' @> jsonb_build_array(jsonb_build_object('id',task)));
  perform pg_temp.check('lead context includes candidates from both led teams',
    jsonb_array_length(public.general_lead_assign_context(p)->'candidates')=3);
  insert into public.general_task_assignees(project_id,task_id,user_id) values(p,task,u[4]);
  insert into public.general_task_assignees(project_id,task_id,user_id) values(p,task,u[3]);
  perform pg_temp.check('lead adds another receiving-team holder',(select count(*)=2 from public.general_task_assignees where task_id=task));
  perform pg_temp.refuse('lead cannot assign outside receiving team',format(
    'insert into public.general_task_assignees(project_id,task_id,user_id) values(%L,%L,%L)',p,task,u[5]));
  perform pg_temp.service();
  delete from public.general_task_assignees where task_id=task;
  update public.general_teams set leader_id=u[4] where id=team;
  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('stale lead cannot assign',format(
    'insert into public.general_task_assignees(project_id,task_id,user_id) values(%L,%L,%L)',p,task,u[4]));
  perform pg_temp.service();
  update public.general_teams set leader_id=u[3] where id=team;
  delete from public.general_team_members where team_id=team and user_id=u[4];
  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('stale receiving membership cannot assign',format(
    'insert into public.general_task_assignees(project_id,task_id,user_id) values(%L,%L,%L)',p,task,u[4]));
  perform pg_temp.service();
  insert into public.general_team_members(project_id,team_id,user_id) values(p,team,u[4]);
  delete from public.general_team_members where team_id=team and user_id=u[3];
  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('lead losing receiving membership cannot assign',format(
    'insert into public.general_task_assignees(project_id,task_id,user_id) values(%L,%L,%L)',p,task,u[4]));
  perform pg_temp.service();
  insert into public.general_team_members(project_id,team_id,user_id) values(p,team,u[3]);
  update public.general_teams set leader_id=u[3] where id=team;
  update public.profiles set status='pending' where id=u[4];
  perform pg_temp.act_as(u[3]);
  perform pg_temp.check('inactive candidates excluded',
    not (public.general_lead_assign_context(p)->'candidates' @> jsonb_build_array(jsonb_build_object('user_id',u[4]))));
  perform pg_temp.refuse('inactive receiving member cannot hold work',format(
    'insert into public.general_task_assignees(project_id,task_id,user_id) values(%L,%L,%L)',p,task,u[4]));
  perform pg_temp.service();
end $$;
rollback;
