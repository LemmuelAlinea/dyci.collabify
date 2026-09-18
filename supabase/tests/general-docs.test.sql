-- Shared documents. Rolls back; nothing here survives.
begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if p_true then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  owner_id  uuid := gen_random_uuid();
  writer_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  outsider  uuid := gen_random_uuid();
  proj      public.general_projects%rowtype;
  doc       public.general_docs%rowtype;
  chg       public.general_doc_changes%rowtype;
  n         int;
  txt       text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Doc', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'doc-owner@test.local', 'Owner'),
                 (writer_id, 'doc-writer@test.local', 'Writer'),
                 (member_id, 'doc-member@test.local', 'Member'),
                 (outsider, 'doc-out@test.local', 'Out')) as v(id, em, ln);

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Doc project', '');

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level)
  values (proj.id, writer_id, 'member'), (proj.id, member_id, 'member');
  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (proj.id, writer_id, 'edit_files', owner_id);

  ------------------------------------------------------------------ creating
  perform pg_temp.act_as(member_id);
  begin
    perform public.create_general_doc(proj.id, 'Not mine');
    perform pg_temp.ok('a Member without edit_files cannot add a document', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a Member without edit_files cannot add a document', true);
  end;

  perform pg_temp.act_as(writer_id);
  doc := public.create_general_doc(proj.id, 'Chapter 1', 'The problem and its background.');
  perform pg_temp.ok('a grant of edit_files is enough to add a document', doc.id is not null);
  perform pg_temp.ok('a new document starts on version 1', doc.version = 1);

  select count(*) into n from public.general_doc_versions where doc_id = doc.id;
  perform pg_temp.ok('creating a document writes its first version', n = 1);

  ------------------------------------------------------------------ writing
  doc := public.write_general_doc(doc.id, 'Rewritten body.', 1, 'Tidied the wording');
  perform pg_temp.ok('a direct write moves the document to version 2', doc.version = 2);

  select v.body into txt from public.general_doc_versions v where v.doc_id = doc.id and v.version = 1;
  perform pg_temp.ok('version 1 still says what it said', txt = 'The problem and its background.');

  begin
    perform public.write_general_doc(doc.id, 'Stale write.', 1, '');
    perform pg_temp.ok('a write against an old version is refused', false);
  exception when serialization_failure then
    perform pg_temp.ok('a write against an old version is refused', true);
  end;

  perform pg_temp.act_as(member_id);
  begin
    perform public.write_general_doc(doc.id, 'Sneaky.', 2, '');
    perform pg_temp.ok('a Member cannot write straight to a document', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a Member cannot write straight to a document', true);
  end;

  ------------------------------------------------------------------ history is a record
  -- No update or delete policy exists on versions, so a statement against one
  -- matches no rows rather than raising. guard_general_doc_version() sits behind
  -- that as a second lock in case a policy is ever added. Either way the record
  -- is untouched, which is what these two assert.
  perform pg_temp.act_as(owner_id);
  update public.general_doc_versions set body = 'Rewriting history'
   where doc_id = doc.id and version = 1;
  select v.body into txt from public.general_doc_versions v
   where v.doc_id = doc.id and v.version = 1;
  perform pg_temp.ok('an Owner cannot edit a written version',
                     txt = 'The problem and its background.');

  delete from public.general_doc_versions where doc_id = doc.id and version = 1;
  select count(*) into n from public.general_doc_versions
   where doc_id = doc.id and version = 1;
  perform pg_temp.ok('an Owner cannot delete a written version', n = 1);

  ------------------------------------------------------------------ proposing
  perform pg_temp.act_as(member_id);
  insert into public.general_doc_changes (doc_id, project_id, author_id, base_version, body, note)
  values (doc.id, proj.id, member_id, 2, 'Rewritten body, with my paragraph.', 'Added the sampling note')
  returning * into chg;
  perform pg_temp.ok('a Member who cannot write can still propose a change', chg.id is not null);
  perform pg_temp.ok('a proposal starts open', chg.status = 'open');

  begin
    insert into public.general_doc_changes (doc_id, project_id, author_id, base_version, body)
    values (doc.id, proj.id, owner_id, 2, 'Not mine');
    perform pg_temp.ok('a change cannot be filed in somebody else''s name', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a change cannot be filed in somebody else''s name', true);
  end;

  begin
    perform public.answer_general_doc_change(chg.id, true, '');
    perform pg_temp.ok('the author cannot apply their own change without edit_files', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('the author cannot apply their own change without edit_files', true);
  end;

  ------------------------------------------------------------------ commenting
  insert into public.general_doc_comments (change_id, project_id, author_id, body)
  values (chg.id, proj.id, member_id, 'Happy to reword if it is too long.');
  select count(*) into n from public.general_doc_comments where change_id = chg.id;
  perform pg_temp.ok('a member can comment on a change', n = 1);

  perform pg_temp.act_as(outsider);
  select count(*) into n from public.general_doc_comments where change_id = chg.id;
  perform pg_temp.ok('a stranger reads no comments', n = 0);
  select count(*) into n from public.general_docs where id = doc.id;
  perform pg_temp.ok('a stranger reads no documents', n = 0);
  select count(*) into n from public.general_doc_versions where doc_id = doc.id;
  perform pg_temp.ok('a stranger reads no versions', n = 0);

  ------------------------------------------------------------------ answering
  perform pg_temp.act_as(writer_id);
  chg := public.answer_general_doc_change(chg.id, true, 'Reads well.');
  perform pg_temp.ok('somebody with edit_files applies a change', chg.status = 'applied');

  select version into n from public.general_docs where id = doc.id;
  perform pg_temp.ok('applying a change moves the document to version 3', n = 3);

  select v.author_id::text into txt from public.general_doc_versions v where v.doc_id = doc.id and v.version = 3;
  perform pg_temp.ok('the applied version is credited to whoever proposed it', txt = member_id::text);

  select count(*) into n from public.general_doc_versions
   where doc_id = doc.id and version = 3 and change_id = chg.id;
  perform pg_temp.ok('the version points back at the change it came from', n = 1);

  begin
    perform public.answer_general_doc_change(chg.id, false, 'Changed my mind');
    perform pg_temp.ok('a change cannot be answered twice', false);
  exception when invalid_parameter_value then
    perform pg_temp.ok('a change cannot be answered twice', true);
  end;

  ------------------------------------------------------- a stale proposal is refused
  perform pg_temp.act_as(member_id);
  insert into public.general_doc_changes (doc_id, project_id, author_id, base_version, body, note)
  values (doc.id, proj.id, member_id, 2, 'Written against an old version.', 'Stale')
  returning * into chg;

  perform pg_temp.act_as(writer_id);
  begin
    perform public.answer_general_doc_change(chg.id, true, '');
    perform pg_temp.ok('a proposal written against an old version cannot be applied', false);
  exception when serialization_failure then
    perform pg_temp.ok('a proposal written against an old version cannot be applied', true);
  end;

  -- A control: the same stale proposal can still be declined.
  chg := public.answer_general_doc_change(chg.id, false, 'Please redo it against version 3.');
  perform pg_temp.ok('a stale proposal can still be declined', chg.status = 'declined');

  select version into n from public.general_docs where id = doc.id;
  perform pg_temp.ok('declining writes no version', n = 3);

  ------------------------------------------------------------------ withdrawing
  perform pg_temp.act_as(member_id);
  insert into public.general_doc_changes (doc_id, project_id, author_id, base_version, body, note)
  values (doc.id, proj.id, member_id, 3, 'Second thoughts.', 'Mine')
  returning * into chg;

  update public.general_doc_changes set status = 'withdrawn'::public.general_change_status where id = chg.id;
  select c.status::text into txt from public.general_doc_changes c where c.id = chg.id;
  perform pg_temp.ok('an author withdraws their own change', txt = 'withdrawn');

  perform pg_temp.act_as(member_id);
  insert into public.general_doc_changes (doc_id, project_id, author_id, base_version, body)
  values (doc.id, proj.id, member_id, 3, 'Another')
  returning * into chg;

  perform pg_temp.act_as(owner_id);
  begin
    update public.general_doc_changes set status = 'withdrawn'::public.general_change_status where id = chg.id;
    select count(*) into n from public.general_doc_changes where id = chg.id and status = 'withdrawn';
    perform pg_temp.ok('an Owner cannot withdraw somebody else''s change', n = 0);
  exception when insufficient_privilege then
    perform pg_temp.ok('an Owner cannot withdraw somebody else''s change', true);
  end;

  begin
    update public.general_doc_changes set status = 'applied'::public.general_change_status where id = chg.id;
    perform pg_temp.ok('a change cannot be applied by a bare update', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a change cannot be applied by a bare update', true);
  end;

  ------------------------------------------------------------------ archived
  perform pg_temp.act_as(owner_id);
  perform public.archive_general_project(proj.id, true);

  perform pg_temp.act_as(writer_id);
  begin
    perform public.write_general_doc(doc.id, 'After archiving.', 3, '');
    perform pg_temp.ok('an archived project freezes its documents', false);
  exception when others then
    perform pg_temp.ok('an archived project freezes its documents', true);
  end;

  perform pg_temp.act_as(member_id);
  begin
    insert into public.general_doc_changes (doc_id, project_id, author_id, base_version, body)
    values (doc.id, proj.id, member_id, 3, 'After archiving');
    perform pg_temp.ok('an archived project takes no new proposals', false);
  exception when others then
    perform pg_temp.ok('an archived project takes no new proposals', true);
  end;

  perform pg_temp.act_as(owner_id);
  perform public.archive_general_project(proj.id, false);

  ------------------------------------------------------- a deactivated account
  perform pg_temp.act_as_service();
  update public.profiles set status = 'rejected' where id = writer_id;

  perform pg_temp.act_as(writer_id);
  begin
    perform public.write_general_doc(doc.id, 'From a dead account.', 3, '');
    perform pg_temp.ok('a deactivated account cannot write a document', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a deactivated account cannot write a document', true);
  end;

  -- A control: an active holder of the same permission still can.
  perform pg_temp.act_as(owner_id);
  doc := public.write_general_doc(doc.id, 'From a live Owner.', 3, 'control');
  perform pg_temp.ok('an active Owner still writes after that refusal', doc.version = 4);

  perform pg_temp.act_as_service();
  update public.profiles set status = 'rejected' where id = member_id;
  perform pg_temp.act_as(member_id);
  begin
    insert into public.general_doc_changes (doc_id, project_id, author_id, base_version, body)
    values (doc.id, proj.id, member_id, 4, 'From a dead account');
    perform pg_temp.ok('a deactivated account cannot propose a change', false);
  exception when others then
    perform pg_temp.ok('a deactivated account cannot propose a change', true);
  end;

  ------------------------------------------------------------------ the overview
  perform pg_temp.act_as(owner_id);
  select open_change_count into n from public.general_doc_overview where id = doc.id;
  perform pg_temp.ok('the overview counts the one change still open', n = 1);

  perform pg_temp.act_as(outsider);
  select count(*) into n from public.general_doc_overview where id = doc.id;
  perform pg_temp.ok('the overview shows a stranger nothing', n = 0);
end $$;

rollback;
