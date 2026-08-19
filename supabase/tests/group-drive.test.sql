-- The group drive — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/group-drive.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement.

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

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 58);
      return;
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
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_out uuid;
  v_set uuid; v_g1 uuid; v_g2 uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
   limit 1;
  select student_id into v_a from public.class_members
   where class_id=v_class and status='active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id=v_class and status='active' and student_id<>v_a order by student_id limit 1;
  select student_id into v_out from public.class_members
   where class_id=v_class and status='active' and student_id not in (v_a,v_b)
   order by student_id limit 1;

  insert into public.group_sets (class_id,name,mode)
  values (v_class,'zz-drive-fixture','manual') returning id into v_set;
  insert into public.groups (set_id,name) values (v_set,'Drive A') returning id into v_g1;
  insert into public.groups (set_id,name) values (v_set,'Drive B') returning id into v_g2;
  insert into public.group_members (group_id,set_id,student_id)
  values (v_g1,v_set,v_a), (v_g2,v_set,v_out);

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('prof',v_prof),('a',v_a),('b',v_b),('out',v_out),
    ('class',v_class),('g1',v_g1),('g2',v_g2);
  raise notice 'fixture ready';
end $$;

-- ---------------------------------------------------------------- uploading

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_out uuid := (select v from fx where k='out');
  g1 uuid := (select v from fx where k='g1');
begin
  -- Somebody in the class but not in this group.
  perform pg_temp.act_as(v_b);
  perform pg_temp.must_refuse('a classmate outside the group cannot upload',
    format('insert into public.group_files (group_id, file_path, file_name, size_bytes)
            values (%L, ''x/1.pdf'', ''1.pdf'', 100)', g1));

  -- A member of a different group in the same set.
  perform pg_temp.act_as(v_out);
  perform pg_temp.must_refuse('another group''s member cannot upload here',
    format('insert into public.group_files (group_id, file_path, file_name, size_bytes)
            values (%L, ''x/2.pdf'', ''2.pdf'', 100)', g1));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('a member uploads to their own group',
    format('insert into public.group_files (group_id, file_path, file_name, size_bytes)
            values (%L, ''x/draft.pdf'', ''draft.pdf'', 1024)', g1));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and it records who put it there',
    (select uploaded_by = v_a from public.group_files
      where group_id = g1 and file_name = 'draft.pdf'));
end $$;

-- Nobody hands the trigger a different uploader than themselves.
do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  g1 uuid := (select v from fx where k='g1');
begin
  perform pg_temp.act_as(v_a);
  insert into public.group_files (group_id, file_path, file_name, size_bytes, uploaded_by)
  values (g1, 'x/spoof.pdf', 'spoof.pdf', 10, v_b);
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('an upload cannot be credited to somebody else',
    (select uploaded_by = v_a from public.group_files
      where group_id = g1 and file_name = 'spoof.pdf'));
end $$;

-- ------------------------------------------------------------------ reading

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_out uuid := (select v from fx where k='out');
  v_prof uuid := (select v from fx where k='prof');
  g1 uuid := (select v from fx where k='g1');
  n int;
begin
  perform pg_temp.act_as(v_a);
  select count(*) into n from public.group_files where group_id = g1;
  perform pg_temp.must_be('a member reads their own group''s drive', n = 2);

  perform pg_temp.act_as(v_b);
  select count(*) into n from public.group_files where group_id = g1;
  perform pg_temp.must_be('a classmate outside the group reads nothing', n = 0);

  perform pg_temp.act_as(v_out);
  select count(*) into n from public.group_files where group_id = g1;
  perform pg_temp.must_be('another group reads nothing of it', n = 0);

  -- Seeing a quiet group is working is the point of letting them look.
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.group_files where group_id = g1;
  perform pg_temp.must_be('the professor can see into the drive', n = 2);

  select count(*) into n from public.group_file_overview
   where group_id = g1 and group_name = 'Drive A' and uploaded_by_name is not null;
  perform pg_temp.must_be('...through the view, with the names around it', n = 2);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ removing

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_prof uuid := (select v from fx where k='prof');
  g1 uuid := (select v from fx where k='g1');
  n int;
begin
  -- Read-only means read-only: a draft is the group's to withdraw.
  perform pg_temp.act_as(v_prof);
  delete from public.group_files where group_id = g1 and file_name = 'spoof.pdf';
  perform pg_temp.act_as_service();
  select count(*) into n from public.group_files where group_id = g1;
  perform pg_temp.must_be('the professor cannot delete a draft', n = 2);

  perform pg_temp.act_as(v_a);
  delete from public.group_files where group_id = g1 and file_name = 'spoof.pdf';
  perform pg_temp.act_as_service();
  select count(*) into n from public.group_files where group_id = g1;
  perform pg_temp.must_be('a member can remove one', n = 1);
end $$;

-- -------------------------------------------------------------------- quota

do $$
declare
  v_a uuid := (select v from fx where k='a');
  g1 uuid := (select v from fx where k='g1');
  cap bigint := public.group_drive_limit();
begin
  perform pg_temp.act_as(v_a);

  perform pg_temp.must_allow('a file just under the ceiling goes in',
    format('insert into public.group_files (group_id, file_path, file_name, size_bytes)
            values (%L, ''x/big.zip'', ''big.zip'', %s)', g1, cap - 2048));

  perform pg_temp.must_refuse('the one that would go over is refused',
    format('insert into public.group_files (group_id, file_path, file_name, size_bytes)
            values (%L, ''x/over.zip'', ''over.zip'', %s)', g1, 1024 * 1024));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('used space is reported back',
    public.group_drive_used(g1) > 0 and public.group_drive_used(g1) <= cap);
end $$;

-- The ceiling is per group, not shared across the class.
do $$
declare
  v_out uuid := (select v from fx where k='out');
  g2 uuid := (select v from fx where k='g2');
begin
  perform pg_temp.act_as(v_out);
  perform pg_temp.must_allow('a different group still has its own room',
    format('insert into public.group_files (group_id, file_path, file_name, size_bytes)
            values (%L, ''y/theirs.pdf'', ''theirs.pdf'', 4096)', g2));
  perform pg_temp.act_as_service();
end $$;

rollback;
