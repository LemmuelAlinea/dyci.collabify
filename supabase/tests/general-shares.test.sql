-- Shared with me: who can share, who can read, and what a copy stays. Rolls back.
--
--   node scripts/db.mjs supabase/tests/general-shares.test.sql

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
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_c uuid; v_out uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  gp uuid; v_repo uuid; s1 uuid; s2 uuid; s3 uuid; n int;
  refused boolean; msg text;
begin
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 4
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;
  select student_id into v_c from public.class_members where class_id = v_class and status = 'active' and student_id not in (v_a, v_b) order by student_id limit 1;
  select student_id into v_out from public.class_members where class_id = v_class and status = 'active' and student_id not in (v_a, v_b, v_c) order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-shares', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Share group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values (v_group, v_set, v_a), (v_group, v_set, v_b), (v_group, v_set, v_c);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'Share lab', 'activity', 1, 1, 'group', v_set, now() + interval '7 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_group;

  perform pg_temp.act_as(v_a);
  gp := public.ensure_class_board_repo(v_board);
  perform pg_temp.svc();
  select id into v_repo from public.general_repos where project_id = gp;
  update public.notification_prefs set submissions = true where user_id in (v_b, v_c);

  perform pg_temp.act_as(v_a);
  perform public.save_general_draft_file(v_repo, 'notes/one.md', 'added', 'text', 'First');
  perform public.save_general_draft_file(v_repo, 'notes/two.md', 'added', 'text', 'Second');
  perform public.save_general_draft_file(v_repo, 'solo.md', 'added', 'text', 'Solo v1');

  ------------------------------------------------------------------ sharing
  s1 := public.share_general_draft_path(v_repo, 'solo.md', false, array[v_b]);
  s2 := public.share_general_draft_path(v_repo, 'notes', true, array[v_b, v_c]);
  perform pg_temp.svc();
  perform pg_temp.ok('a file is shared as one copy',
    (select jsonb_array_length(files) = 1 and files -> 0 ->> 'content' = 'Solo v1' from public.general_shares where id = s1));
  perform pg_temp.ok('a folder carries every file in it',
    (select jsonb_array_length(files) from public.general_shares where id = s2) = 2);
  perform pg_temp.ok('each recipient gets a notice pointing at the class project',
    (select count(*) from public.notifications where type = 'file_shared' and user_id = v_b
       and project_id = v_proj and general_project_id is null) = 2
    and exists (select 1 from public.notifications where type = 'file_shared' and user_id = v_c));

  perform pg_temp.act_as(v_a);
  begin
    perform public.share_general_draft_path(v_repo, 'solo.md', false, array[v_out]);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('nobody outside the group can be picked', refused);

  begin
    perform public.share_general_draft_path(v_repo, 'solo.md', false, array[v_prof]);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('...not even the professor', refused);

  begin
    perform public.share_general_draft_path(v_repo, 'solo.md', false, array[v_a]);
    refused := false;
  exception when invalid_parameter_value then refused := true;
  end;
  perform pg_temp.ok('you cannot share with yourself', refused);

  begin
    perform public.share_general_draft_path(v_repo, 'missing.md', false, array[v_b]);
    refused := false;
  exception when no_data_found then refused := true;
  end;
  perform pg_temp.ok('something not in your draft cannot be shared', refused);

  begin
    insert into public.general_shares (project_id, repo_id, sender_id, type, path)
    values (gp, v_repo, v_a, 'file', 'x.md');
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('no direct writes to the table', refused);

  ------------------------------------------------------------------ reading
  perform pg_temp.act_as(v_b);
  perform pg_temp.ok('the recipient reads both shares',
    (select count(*) from public.general_shares where project_id = gp) = 2);
  perform pg_temp.act_as(v_c);
  perform pg_temp.ok('a teammate reads only what went to them',
    (select count(*) from public.general_shares where project_id = gp) = 1);
  perform pg_temp.act_as(v_out);
  perform pg_temp.ok('a classmate outside the group reads nothing',
    not exists (select 1 from public.general_shares where project_id = gp)
    and not exists (select 1 from public.general_share_recipients where share_id = s1));
  perform pg_temp.act_as(v_prof);
  perform pg_temp.ok('the professor reads nothing', not exists (select 1 from public.general_shares where project_id = gp));

  ------------------------------------------------------------------ a copy stays a copy
  perform pg_temp.act_as(v_a);
  perform public.save_general_draft_file(v_repo, 'solo.md', 'added', 'text', 'Solo v2');
  perform pg_temp.svc();
  perform pg_temp.ok('editing the draft leaves the share as it was',
    (select files -> 0 ->> 'content' from public.general_shares where id = s1) = 'Solo v1');

  perform pg_temp.act_as(v_a);
  s3 := public.share_general_draft_path(v_repo, 'solo.md', false, array[v_b]);
  perform pg_temp.svc();
  perform pg_temp.ok('sharing again replaces the older copy',
    not exists (select 1 from public.general_shares where id = s1)
    and (select files -> 0 ->> 'content' from public.general_shares where id = s3) = 'Solo v2');

  ------------------------------------------------------------------ copying
  perform pg_temp.act_as(v_b);
  n := public.copy_general_share_to_draft(s2);
  perform pg_temp.ok('the recipient copies a folder into their draft', n = 2
    and (select count(*) from public.general_draft_files f join public.general_drafts d on d.id = f.draft_id
          where d.user_id = v_b and d.repo_id = v_repo and f.path like 'notes/%') = 2);
  begin
    perform public.copy_general_share_to_draft(s2);
    refused := false;
  exception when unique_violation then refused := true; msg := sqlerrm;
  end;
  perform pg_temp.ok('copying over a path already in the draft is refused, naming it',
    refused and msg like '%notes/one.md%');

  perform pg_temp.act_as(v_c);
  begin
    perform public.copy_general_share_to_draft(s3);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('someone it did not go to cannot copy it', refused);

  ------------------------------------------------------------------ removing
  perform pg_temp.act_as(v_c);
  perform public.dismiss_general_share(s2);
  perform pg_temp.ok('a recipient removes it from their list',
    not exists (select 1 from public.general_shares where id = s2));
  perform pg_temp.act_as(v_b);
  perform pg_temp.ok('...and the others keep it', exists (select 1 from public.general_shares where id = s2));

  begin
    perform public.unshare_general_share(s3);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('only the sender can stop sharing', refused);
  perform pg_temp.act_as(v_a);
  perform public.unshare_general_share(s3);
  perform pg_temp.svc();
  perform pg_temp.ok('the sender stops sharing', not exists (select 1 from public.general_shares where id = s3));

  perform pg_temp.act_as(v_b);
  perform public.dismiss_general_share(s2);
  perform pg_temp.svc();
  perform pg_temp.ok('the last recipient removing it clears the share',
    not exists (select 1 from public.general_shares where id = s2));

  ------------------------------------------------------------------ freezing
  perform pg_temp.act_as(v_a);
  perform public.set_board_submitted(v_board, true);
  begin
    perform public.share_general_draft_path(v_repo, 'solo.md', false, array[v_b]);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a handed-in board takes no new shares', refused);
  perform public.set_board_submitted(v_board, false);

  ------------------------------------------------------------------ leaving
  s1 := public.share_general_draft_path(v_repo, 'solo.md', false, array[v_c]);
  perform pg_temp.svc();
  delete from public.group_members where group_id = v_group and student_id = v_c;
  perform pg_temp.act_as(v_c);
  perform pg_temp.ok('leaving the group takes shares away', not exists (select 1 from public.general_shares where id = s1));
  perform pg_temp.svc();
end;
$$;

rollback;
