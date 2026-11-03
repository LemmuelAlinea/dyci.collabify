-- Reviewed member setup. Run after project-workflow-rules.sql, then anon-lockdown.sql.
begin;
create or replace function public.apply_general_member_import(
  p_project uuid, p_mode text, p_rows jsonb, p_expected jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_project public.general_projects%rowtype;
  v_current jsonb; v_members jsonb; v_teams jsonb; v_positions jsonb;
  v_desired jsonb := '[]'; v_retry jsonb; v_retry_members jsonb := '[]';
  v_retry_teams jsonb; v_retry_positions jsonb;
  r jsonb; x jsonb; item jsonb; old_member jsonb; expected_member jsonb;
  desired_member jsonb; team_ids jsonb; position_ids jsonb; tags jsonb;
  uid uuid; tid uuid; name text; team text; tag text; n int;
  created_teams int := 0; created_positions int := 0; changed_members int := 0;
begin
  if auth.uid() is null then
    raise exception 'Only the project manager and coordinators can import members.' using errcode='insufficient_privilege';
  end if;
  if p_mode is null or p_mode not in ('add','replace')
     or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Choose Add or Replace and review the member rows again.';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 100 or octet_length(p_rows::text)>500000 then
    raise exception 'Import between 1 and 100 members at a time.';
  end if;
  if jsonb_typeof(p_expected) is distinct from 'object'
     or jsonb_typeof(p_expected->'members') is distinct from 'array'
     or jsonb_typeof(p_expected->'teams') is distinct from 'array'
     or jsonb_typeof(p_expected->'positions') is distinct from 'array'
     or p_expected - array['members','teams','positions'] <> '{}' then
    raise exception 'Refresh the project and review the import again.';
  end if;

  for x in select value from jsonb_array_elements(p_expected->'members') loop
    if jsonb_typeof(x) is distinct from 'object' or not x ?& array['user_id','role','team_ids','position_ids','skills']
       or x - array['user_id','role','team_ids','position_ids','skills']<>'{}'
       or jsonb_typeof(x->'user_id') is distinct from 'string'
       or jsonb_typeof(x->'role') is distinct from 'string'
       or jsonb_typeof(x->'team_ids') is distinct from 'array'
       or jsonb_typeof(x->'position_ids') is distinct from 'array'
       or jsonb_typeof(x->'skills') is distinct from 'object' then
      raise exception 'Refresh the project and review complete member details again.';
    end if;
  end loop;

  select * into v_project from public.general_projects where id=p_project for update;
  if v_project.id is null or v_project.class_board_id is not null then
    raise exception 'Import members into an active work project.';
  end if;
  perform 1 from public.general_spaces where id=v_project.space_id for share;
  perform 1 from public.profiles where id=auth.uid() for share;
  -- These parent locks also block FK-backed inserts, including catalog phantoms.
  perform 1 from public.general_members where project_id=p_project order by user_id for update;
  if not exists(select 1 from public.general_members m join public.profiles pr on pr.id=m.user_id
    where m.project_id=p_project and m.user_id=auth.uid() and m.role in ('pm','coordinator') and pr.status='active') then
    raise exception 'Only the project manager and coordinators can import members.' using errcode='insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) or v_project.trashed_at is not null then
    raise exception 'This project is archived or in Trash. Restore it before importing members.';
  end if;
  perform 1 from public.general_teams where project_id=p_project order by id for update;
  perform 1 from public.general_positions where project_id=p_project order by id for update;
  perform 1 from public.general_team_members where project_id=p_project order by team_id,user_id for update;
  perform 1 from public.general_position_holders where project_id=p_project order by position_id,user_id for update;
  perform 1 from public.general_member_skills s where s.project_id=p_project order by s.user_id,s.tag for update;

  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) is distinct from 'object' or not r ?& array['user_id','teams','positions','skills']
       or r - array['user_id','teams','positions','skills'] <> '{}'
       or jsonb_typeof(r->'user_id') is distinct from 'string'
       or (r->>'user_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Review valid current member IDs and fields before importing.';
    end if;
    if not exists(select 1 from public.general_members where project_id=p_project and user_id=(r->>'user_id')::uuid) then
      raise exception 'A person is no longer a project member. Refresh and upload again.';
    end if;
    foreach name in array array['teams','positions','skills'] loop
      if jsonb_typeof(r->name) not in ('null','array') then
        raise exception 'Review the member team, position and skill lists again.';
      end if;
      if jsonb_typeof(r->name)='array' and jsonb_array_length(r->name)>100 then
        raise exception 'Use at most 100 values in each member field.';
      end if;
    end loop;
  end loop;
  if (select count(distinct value->>'user_id') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then
    raise exception 'Combine duplicate member rows before importing.';
  end if;

  if jsonb_array_length(p_expected->'members')<>jsonb_array_length(p_rows)
     or (select count(distinct value->>'user_id') from jsonb_array_elements(p_expected->'members'))<>jsonb_array_length(p_rows) then
    raise exception 'Refresh the project and review each member once.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', m.user_id, 'role', m.role,
    'team_ids', coalesce((select jsonb_agg(t.team_id order by t.team_id::text collate "C") from public.general_team_members t where t.project_id=p_project and t.user_id=m.user_id),'[]'),
    'position_ids', coalesce((select jsonb_agg(h.position_id order by h.position_id::text collate "C") from public.general_position_holders h where h.project_id=p_project and h.user_id=m.user_id),'[]'),
    'skills', coalesce((select jsonb_object_agg(s.tag,true) from public.general_member_skills s where s.project_id=p_project and s.user_id=m.user_id),'{}')
  ) order by m.user_id::text collate "C"),'[]') into v_members
  from public.general_members m where m.project_id=p_project
    and m.user_id in (select (value->>'user_id')::uuid from jsonb_array_elements(p_rows));
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'leader_id',t.leader_id,'archived',t.archived_at is not null) order by t.id::text collate "C"),'[]')
    into v_teams from public.general_teams t where t.project_id=p_project;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'team_id',t.team_id) order by t.id::text collate "C"),'[]')
    into v_positions from public.general_positions t where t.project_id=p_project;
  v_current := jsonb_build_object('members',v_members,'teams',v_teams,'positions',v_positions);
  v_retry_teams := p_expected->'teams'; v_retry_positions := p_expected->'positions';

  for r in select value from jsonb_array_elements(p_rows) order by value->>'user_id' collate "C" loop
    uid := (r->>'user_id')::uuid;
    select value into old_member from jsonb_array_elements(v_members) where value->>'user_id'=uid::text;
    select value into expected_member from jsonb_array_elements(p_expected->'members') where value->>'user_id'=uid::text;
    if expected_member is null then raise exception 'Refresh the project and review each member again.'; end if;
    team_ids := case when r->'teams'='null' then old_member->'team_ids' else '[]'::jsonb end;
    position_ids := case when r->'positions'='null' then old_member->'position_ids' else '[]'::jsonb end;
    tags := case when r->'skills'='null' then old_member->'skills' else '{}'::jsonb end;

    -- Resolve all referenced teams first; positions must name a team in the reviewed final list.
    for x in select value from jsonb_array_elements(case when r->'teams'='null' then '[]'::jsonb else r->'teams' end) loop
      if jsonb_typeof(x)<>'string' then raise exception 'Each team must have a name, not an ID.'; end if;
      name := btrim(regexp_replace(x#>>'{}','\s+',' ','g'));
      if char_length(name) not between 1 and 80 then raise exception 'Keep team names between 1 and 80 characters.'; end if;
      select count(*), (jsonb_agg(value)->0) into n,item from jsonb_array_elements(v_teams)
        where lower(btrim(regexp_replace(value->>'name','\s+',' ','g')))=lower(name);
      if n>1 then raise exception 'More than one team matches %. Rename the duplicate before importing.',name; end if;
      if n=0 then
        item := jsonb_build_object('id',gen_random_uuid(),'name',name,'leader_id',null,'archived',false);
        v_teams := v_teams || jsonb_build_array(item); created_teams := created_teams+1;
      elsif (item->>'archived')::boolean and not (
        (old_member->'team_ids') @> jsonb_build_array(item->'id')
        and (expected_member->'team_ids') @> jsonb_build_array(item->'id')
      ) then raise exception 'Restore the archived team % before importing.',name;
      end if;
      team_ids := team_ids || jsonb_build_array(item->'id');
      if not exists(select 1 from jsonb_array_elements(v_retry_teams) e where e->'id'=item->'id') then
        v_retry_teams := v_retry_teams || jsonb_build_array(item || jsonb_build_object('leader_id',null,'archived',false));
      end if;
    end loop;
    select coalesce(jsonb_agg(value order by value#>>'{}' collate "C"),'[]') into team_ids from (select distinct value from jsonb_array_elements(team_ids)) d;

    for x in select value from jsonb_array_elements(case when r->'positions'='null' then '[]'::jsonb else r->'positions' end) loop
      if jsonb_typeof(x) is distinct from 'object' or not x ?& array['team','name'] or x - array['team','name']<>'{}'
         or jsonb_typeof(x->'team') is distinct from 'string' or jsonb_typeof(x->'name') is distinct from 'string' then
        raise exception 'Each position needs a name and explicit team or project-wide scope.';
      end if;
      name := btrim(regexp_replace(x->>'name','\s+',' ','g'));
      team := btrim(regexp_replace(x->>'team','\s+',' ','g')); tid := null;
      if char_length(name) not between 1 and 80 then raise exception 'Keep position names between 1 and 80 characters.'; end if;
      if team<>'' then
        select count(*),(jsonb_agg(value)->0) into n,item from jsonb_array_elements(v_teams)
          where lower(btrim(regexp_replace(value->>'name','\s+',' ','g')))=lower(team);
        if n<>1 or not team_ids @> jsonb_build_array(item->'id') then
          raise exception 'A team-scoped position needs one active team in the member''s reviewed teams.';
        end if;
        tid := (item->>'id')::uuid;
      end if;
      select count(*),(jsonb_agg(value)->0) into n,item from jsonb_array_elements(v_positions)
        where (value->>'team_id')::uuid is not distinct from tid
          and lower(btrim(regexp_replace(value->>'name','\s+',' ','g')))=lower(name);
      if n>1 then raise exception 'More than one position matches %. Rename the duplicate before importing.',name; end if;
      if n=0 then
        item := jsonb_build_object('id',gen_random_uuid(),'name',name,'team_id',tid);
        v_positions := v_positions || jsonb_build_array(item); created_positions := created_positions+1;
      end if;
      if exists(select 1 from jsonb_array_elements(v_teams) t where t->>'id'=tid::text and (t->>'archived')::boolean)
         and not ((old_member->'position_ids') @> jsonb_build_array(item->'id')
                  and (expected_member->'position_ids') @> jsonb_build_array(item->'id')) then
        raise exception 'Restore the archived team before assigning a new position.';
      end if;
      position_ids := position_ids || jsonb_build_array(item->'id');
      if not exists(select 1 from jsonb_array_elements(v_retry_positions) e where e->'id'=item->'id') then
        v_retry_positions := v_retry_positions || jsonb_build_array(item);
      end if;
    end loop;
    select coalesce(jsonb_agg(value order by value#>>'{}' collate "C"),'[]') into position_ids from (select distinct value from jsonb_array_elements(position_ids)) d;
    for x in select value from jsonb_array_elements(case when r->'skills'='null' then '[]'::jsonb else r->'skills' end) loop
      if jsonb_typeof(x)<>'string' then raise exception 'Each skill must be a name.'; end if;
      tag := btrim(regexp_replace(x#>>'{}','\s+',' ','g'));
      if char_length(tag) not between 1 and 40 then raise exception 'Keep skills between 1 and 40 characters.'; end if;
      select key into name from jsonb_each(old_member->'skills') where lower(key)=lower(tag);
      tag := coalesce(name,tag);
      if not exists(select 1 from jsonb_each(tags) where lower(key)=lower(tag)) then tags := tags || jsonb_build_object(tag,true); end if;
    end loop;
    if (select count(*) from jsonb_each(tags))>12 then raise exception 'Up to 12 skills each.'; end if;
    if tags<>'{}' and old_member->>'role' in ('qa','stakeholder') then raise exception 'QA and stakeholders cannot carry skills.'; end if;
    if p_mode='add' and (not team_ids @> (old_member->'team_ids') or not position_ids @> (old_member->'position_ids') or not tags @> (old_member->'skills')) then
      raise exception 'Add must keep current teams, positions and skills. Refresh and review again.';
    end if;
    if exists(select 1 from jsonb_array_elements(v_teams) t where t->>'leader_id'=uid::text and not team_ids @> jsonb_build_array(t->'id')) then
      raise exception 'Change the team leader before removing their membership.';
    end if;
    if exists(select 1 from jsonb_array_elements(v_positions) t where position_ids @> jsonb_build_array(t->'id') and t->'team_id'<>'null' and not team_ids @> jsonb_build_array(t->'team_id')) then
      raise exception 'A retained position still needs its team. Correct the reviewed teams or positions.';
    end if;
    desired_member := old_member || jsonb_build_object('team_ids',team_ids,'position_ids',position_ids,'skills',tags);
    v_desired := v_desired || jsonb_build_array(desired_member);
    if desired_member<>old_member then changed_members := changed_members+1; end if;
    v_retry_members := v_retry_members || jsonb_build_array(expected_member || jsonb_build_object(
      'team_ids',case when r->'teams'='null' then expected_member->'team_ids' else team_ids end,
      'position_ids',case when r->'positions'='null' then expected_member->'position_ids' else position_ids end,
      'skills',case when r->'skills'='null' then expected_member->'skills' else tags end));
  end loop;

  if p_expected<>v_current then
    select coalesce(jsonb_agg(value order by value->>'id' collate "C"),'[]') into v_retry_teams from jsonb_array_elements(v_retry_teams);
    select coalesce(jsonb_agg(value order by value->>'id' collate "C"),'[]') into v_retry_positions from jsonb_array_elements(v_retry_positions);
    v_retry := jsonb_build_object('members',v_retry_members,'teams',v_retry_teams,'positions',v_retry_positions);
    if created_teams=0 and created_positions=0 and changed_members=0 and v_retry=v_current then
      return jsonb_build_object('teams',0,'positions',0,'members',0);
    end if;
    raise exception 'Project members or structure changed. Refresh the project and review the import again.';
  end if;

  insert into public.general_teams(id,project_id,name)
    select (value->>'id')::uuid,p_project,value->>'name' from jsonb_array_elements(v_teams)
    where not exists(select 1 from public.general_teams t where t.id=(value->>'id')::uuid);
  for r in select value from jsonb_array_elements(v_desired) loop
    uid := (r->>'user_id')::uuid;
    insert into public.general_team_members(project_id,team_id,user_id)
      select p_project,(value#>>'{}')::uuid,uid from jsonb_array_elements(r->'team_ids')
      where not exists(select 1 from public.general_team_members t where t.project_id=p_project and t.user_id=uid and t.team_id=(value#>>'{}')::uuid);
  end loop;
  insert into public.general_positions(id,project_id,team_id,name)
    select (value->>'id')::uuid,p_project,(value->>'team_id')::uuid,value->>'name' from jsonb_array_elements(v_positions)
    where not exists(select 1 from public.general_positions t where t.id=(value->>'id')::uuid);
  for r in select value from jsonb_array_elements(v_desired) loop
    uid := (r->>'user_id')::uuid;
    delete from public.general_position_holders h where h.project_id=p_project and h.user_id=uid and not r->'position_ids' @> to_jsonb(array[h.position_id]);
    insert into public.general_position_holders(project_id,position_id,user_id)
      select p_project,(value#>>'{}')::uuid,uid from jsonb_array_elements(r->'position_ids')
      where not exists(select 1 from public.general_position_holders h where h.project_id=p_project and h.user_id=uid and h.position_id=(value#>>'{}')::uuid);
    delete from public.general_team_members t where t.project_id=p_project and t.user_id=uid and not r->'team_ids' @> to_jsonb(array[t.team_id]);
    delete from public.general_member_skills s where s.project_id=p_project and s.user_id=uid and not (r->'skills') ? s.tag;
    insert into public.general_member_skills(project_id,user_id,tag)
      select p_project,uid,key from jsonb_each(r->'skills')
      where not exists(select 1 from public.general_member_skills s where s.project_id=p_project and s.user_id=uid and s.tag=key);
  end loop;
  return jsonb_build_object('teams',created_teams,'positions',created_positions,'members',changed_members);
end;
$$;
revoke all on function public.apply_general_member_import(uuid,text,jsonb,jsonb) from public, anon, service_role;
grant execute on function public.apply_general_member_import(uuid,text,jsonb,jsonb) to authenticated;
commit;
