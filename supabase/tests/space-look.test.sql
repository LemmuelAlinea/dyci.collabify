-- supabase/tests/space-look.test.sql
-- A work space's color and icon: who sets them, what they accept, who reads them.
-- Rolls back; nothing survives.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/space-look.test.sql
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

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** Runs a statement and asserts it is refused, for the reason under test. */
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_needle) in lower(sqlerrm)) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

do $$
declare
  v_pm      uuid := gen_random_uuid();  -- creates the space, its project manager
  v_coord   uuid := gen_random_uuid();  -- a coordinator of the space
  v_member  uuid := gen_random_uuid();  -- a member of the space
  v_out     uuid := gen_random_uuid();  -- not in the space
  v_teacher uuid := gen_random_uuid();  -- owns a class's space
  v_space   uuid;
  v_class   uuid;
  n         int;
begin
  perform pg_temp.act_as_service();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (v_pm), (v_coord), (v_member), (v_out), (v_teacher)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values (v_pm,      v_pm::text      || '@test.invalid', 'Zz', 'Look pm',      'member', 'active', false, true),
         (v_coord,   v_coord::text   || '@test.invalid', 'Zz', 'Look coord',   'member', 'active', false, false),
         (v_member,  v_member::text  || '@test.invalid', 'Zz', 'Look member',  'member', 'active', false, false),
         (v_out,     v_out::text     || '@test.invalid', 'Zz', 'Look out',     'member', 'active', false, true),
         (v_teacher, v_teacher::text || '@test.invalid', 'Zz', 'Look teacher', 'member', 'active', true,  false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_teach = excluded.can_teach, can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_space := (public.create_general_space('Zz Look space', '')).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, role) values
    (v_space, v_coord, 'coordinator'), (v_space, v_member, 'member');
  insert into public.general_spaces (name, kind, created_by)
  values ('Zz Look class space', 'education', v_teacher) returning id into v_class;
  insert into public.general_space_members (space_id, user_id, level) values (v_class, v_teacher, 'owner');

  perform pg_temp.must_be('a new space has no look',
    (select color is null and icon is null from public.general_spaces where id = v_space));

  ------------------------------------------------------------ 1. the project manager sets it
  perform pg_temp.act_as(v_pm);
  perform public.set_general_space_look(v_space, 'teal', 'kanban');
  perform pg_temp.must_be('the project manager sets a swatch and an icon',
    (select color = 'teal' and icon = 'kanban' from public.general_spaces where id = v_space));
  perform public.set_general_space_look(v_space, '#3a6ff7', 'kanban');
  perform pg_temp.must_be('...and a custom color',
    (select color = '#3a6ff7' from public.general_spaces where id = v_space));
  perform public.set_general_space_look(v_space, null, '');
  perform pg_temp.must_be('...and clears both back to the plain tile',
    (select color is null and icon is null from public.general_spaces where id = v_space));

  ------------------------------------------------------------ 2. only the fixed sets
  perform pg_temp.must_refuse_with('an icon outside the set is refused',
    format($q$select public.set_general_space_look(%L, null, 'rocket')$q$, v_space), 'general_spaces_icon_check');
  perform pg_temp.must_refuse_with('a color outside the swatches is refused',
    format($q$select public.set_general_space_look(%L, 'pink', null)$q$, v_space), 'general_spaces_color_check');
  perform pg_temp.must_refuse_with('an upper-case hex is refused',
    format($q$select public.set_general_space_look(%L, '#3A6FF7', null)$q$, v_space), 'general_spaces_color_check');

  perform public.set_general_space_look(v_space, 'violet', 'crown');

  ------------------------------------------------------------ 3. nobody else writes it
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('a coordinator cannot change it',
    format($q$select public.set_general_space_look(%L, 'rose', 'bell')$q$, v_space), 'project manager');
  perform pg_temp.act_as(v_member);
  perform pg_temp.must_refuse_with('a member cannot change it',
    format($q$select public.set_general_space_look(%L, 'rose', 'bell')$q$, v_space), 'project manager');
  update public.general_spaces set icon = 'bell' where id = v_space;
  get diagnostics n = row_count;
  perform pg_temp.must_be('...nor write the table directly', n = 0);
  perform pg_temp.must_be('...but reads it',
    (select color = 'violet' and icon = 'crown' from public.general_spaces where id = v_space));
  perform pg_temp.act_as(v_out);
  perform pg_temp.must_refuse_with('somebody outside the space cannot change it',
    format($q$select public.set_general_space_look(%L, 'rose', 'bell')$q$, v_space), 'project manager');
  perform pg_temp.must_be('...nor read it',
    not exists (select 1 from public.general_spaces where id = v_space));

  ------------------------------------------------------------ 4. a class's space and an archived space
  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_refuse_with('a class''s space takes no look',
    format($q$select public.set_general_space_look(%L, 'teal', null)$q$, v_class), 'class');

  perform pg_temp.act_as_service();
  update public.general_spaces set archived_at = now() where id = v_space;
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('an archived space keeps its look',
    format($q$select public.set_general_space_look(%L, 'rose', 'bell')$q$, v_space), 'archived');

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the look is as the project manager left it',
    (select color = 'violet' and icon = 'crown' from public.general_spaces where id = v_space));
end;
$$;

rollback;
