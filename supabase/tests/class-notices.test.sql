-- A class announcement is for a day — rolled back, touches nothing.
--
--   node scripts/db.mjs supabase/tests/class-notices.test.sql
--
-- Paired throughout: a window that hid everything would pass the "the old one
-- is gone" half on its own, so every one of those is set beside a fresh
-- announcement that has to still be there.

begin;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

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

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_prof uuid; v_class uuid; v_stud uuid; v_other uuid;
begin
  select professor_id, id into v_prof, v_class
    from public.classes where archived_at is null limit 1;
  select student_id into v_stud from public.class_members
   where class_id = v_class and status = 'active' limit 1;

  -- A professor of some other class, to prove the window is not what stops
  -- them: they must see nothing here at any age.
  select id into v_other from public.profiles
   where role = 'professor' and id <> v_prof order by created_at limit 1;

  insert into public.announcements (class_id, author_id, title, body, created_at)
  values
    (v_class, v_prof, 'zz two hours',   'inside',        now() - interval '2 hours'),
    (v_class, v_prof, 'zz two days',    'outside',       now() - interval '2 days'),
    (v_class, v_prof, 'zz just inside', 'one to spare',  now() - interval '23 hours 59 minutes'),
    (v_class, v_prof, 'zz just outside','one too late',  now() - interval '24 hours 1 minute');

  create temp table fx (k text primary key, v uuid) on commit drop;
  insert into fx values
    ('prof', v_prof), ('class', v_class), ('stud', v_stud), ('other', v_other);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------ the student

do $$
declare
  v_stud uuid := (select v from fx where k='stud');
  n int;
begin
  perform pg_temp.act_as(v_stud);

  select count(*) into n from public.announcements where title = 'zz two hours';
  perform pg_temp.must_be('an announcement from this morning is on the feed', n = 1);
  select count(*) into n from public.announcements where title = 'zz two days';
  perform pg_temp.must_be('...and one from two days ago is not', n = 0);
  select count(*) into n from public.announcements where title = 'zz just inside';
  perform pg_temp.must_be('23h59m still counts as today', n = 1);
  select count(*) into n from public.announcements where title = 'zz just outside';
  perform pg_temp.must_be('24h01m does not', n = 0);

  perform pg_temp.act_as_service();
end $$;

-- ---------------------------------------------------------- the professor

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  n int;
begin
  perform pg_temp.act_as(v_prof);

  select count(*) into n from public.announcements where title like 'zz %';
  perform pg_temp.must_be('the professor keeps every one of the four', n = 4);
  select count(*) into n from public.announcements where title = 'zz two days';
  perform pg_temp.must_be('...including the one the class can no longer see', n = 1);

  perform pg_temp.act_as_service();
end $$;

-- --------------------------------------------------- what did not change

/**
 * The window is a narrowing, not a widening. A professor from another class
 * must still see nothing here — at any age — or this file would have traded a
 * stale feed for a leak.
 */
do $$
declare
  v_other uuid := (select v from fx where k='other');
  n int;
begin
  if v_other is null then
    raise notice 'PASS  (skipped: no second professor in this database)';
    return;
  end if;
  perform pg_temp.act_as(v_other);

  select count(*) into n from public.announcements where title like 'zz %';
  perform pg_temp.must_be('another class''s professor sees none of them', n = 0);

  perform pg_temp.act_as_service();
end $$;

-- Editing corrects the record; it does not put it back on a screen.
do $$
declare
  v_stud uuid := (select v from fx where k='stud');
  n int;
begin
  update public.announcements
     set body = 'corrected', edited_at = now()
   where title = 'zz two days';

  perform pg_temp.act_as(v_stud);
  select count(*) into n from public.announcements where title = 'zz two days';
  perform pg_temp.must_be('editing an expired announcement does not re-post it', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- An attachment follows its announcement out of view.
do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_stud uuid := (select v from fx where k='stud');
  v_old uuid; v_new uuid; n int;
begin
  select id into v_old from public.announcements where title = 'zz two days';
  select id into v_new from public.announcements where title = 'zz two hours';

  insert into public.announcement_attachments
    (announcement_id, file_path, file_name, mime_type, size_bytes)
  values (v_old, 'zz/old.pdf', 'old.pdf', 'application/pdf', 10),
         (v_new, 'zz/new.pdf', 'new.pdf', 'application/pdf', 10);

  perform pg_temp.act_as(v_stud);
  select count(*) into n from public.announcement_attachments where file_name = 'new.pdf';
  perform pg_temp.must_be('the fresh announcement''s file is reachable', n = 1);
  select count(*) into n from public.announcement_attachments where file_name = 'old.pdf';
  perform pg_temp.must_be('...and the expired one''s is not', n = 0);
  perform pg_temp.act_as_service();
end $$;

rollback;
