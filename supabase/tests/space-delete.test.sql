-- Deleting a space: only once archived, and everything in it goes. Rolls back.
--
--   node scripts/db.mjs supabase/tests/space-delete.test.sql

begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.svc() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_true, false) then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  owner_id uuid := gen_random_uuid();
  mate_id  uuid := gen_random_uuid();
  sp  public.general_spaces%rowtype;
  p1  public.general_projects%rowtype;
  p2  public.general_projects%rowtype;
  r1  public.general_repos%rowtype;
  t1  uuid;
  refused boolean;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Del', 'last_name', v.ln, 'role', 'professor'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'sdel-owner@test.local', 'Owner'),
                 (mate_id, 'sdel-mate@test.local', 'Mate')) as v(id, em, ln);
  update public.profiles set status = 'active' where id in (owner_id, mate_id);

  perform pg_temp.act_as(owner_id);
  sp := public.create_general_space('Space to delete', '');
  p1 := public.create_general_project('With history', '', null, null, null, null, sp.id);
  r1 := public.create_general_repo(p1.id, 'Files');
  perform public.commit_general_files(r1.id, 'First', 0,
    '[{"path": "a.md", "action": "added", "content": "A"}]'::jsonb);
  perform public.my_general_draft(r1.id);
  perform public.save_general_draft_file(r1.id, 'b.md', 'added', 'text', 'B');
  insert into public.general_tasks (project_id, title, created_by) values (p1.id, 'A task', owner_id)
  returning id into t1;
  insert into public.general_task_comments (task_id, project_id, author_id, body)
  values (t1, p1.id, owner_id, 'A comment');
  p2 := public.create_general_project('Archived one', '', null, null, null, null, sp.id);
  perform public.archive_general_project(p2.id, true);

  -- The space's Owner is not on the first project at all.
  perform pg_temp.svc();
  insert into public.general_space_members (space_id, user_id, level) values (sp.id, mate_id, 'member')
  on conflict do nothing;
  insert into public.general_members (project_id, user_id, level) values (p1.id, mate_id, 'owner');
  delete from public.general_members where project_id = p1.id and user_id = owner_id;

  ------------------------------------------------------------------ live spaces stay
  perform pg_temp.act_as(owner_id);
  begin
    perform public.delete_general_space(sp.id);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a space that is not archived cannot be deleted', refused);

  perform public.archive_general_space(sp.id, true);
  perform pg_temp.act_as(mate_id);
  begin
    perform public.delete_general_space(sp.id);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a member who is not its Owner cannot delete it', refused);

  ------------------------------------------------------------------ an archived space goes, whole
  perform pg_temp.act_as(owner_id);
  perform public.delete_general_space(sp.id);
  perform pg_temp.ok('the caller is still themselves afterwards', auth.uid() = owner_id);
  perform pg_temp.svc();
  perform pg_temp.ok('its Owner deletes the archived space', not exists (select 1 from public.general_spaces where id = sp.id));
  perform pg_temp.ok('...with a project they were not on, and its history',
    not exists (select 1 from public.general_projects where id = p1.id)
    and not exists (select 1 from public.general_commits where project_id = p1.id)
    and not exists (select 1 from public.general_tasks where project_id = p1.id));
  perform pg_temp.ok('...and an archived project', not exists (select 1 from public.general_projects where id = p2.id));
end $$;

rollback;
