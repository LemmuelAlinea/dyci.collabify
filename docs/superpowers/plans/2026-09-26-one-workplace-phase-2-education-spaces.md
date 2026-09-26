# One workplace, phase 2: education spaces underneath — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every class becomes a space of kind `education`. Its roster, owner, name and archive state stay in step with the class automatically. Faculty added to a class's space as Owner or Manager become co-teachers with the full teaching checks. A class can cap its size, and students can join from an invite link. The screens people use today keep working unchanged.

**Architecture:** One new idempotent SQL file, `supabase/one-workplace.sql`, runs after `access.sql`. The class stays the thing people create and edit. Triggers on `classes` create its space and keep it following the class. A trigger on `class_members` mirrors the roster into `general_space_members`. Guards on the General tables refuse any other way of changing a class's space. `is_class_professor` and the helpers that repeated its check now accept co-teachers. The General screens hide education spaces until phase 3 shows them properly.

**Tech stack:** Postgres/Supabase (SQL suites via `node scripts/db.mjs`), React 19 + TypeScript + Vite + React Router, Vitest (node environment, pure functions only).

**Spec:** `docs/superpowers/specs/2026-09-26-one-workplace-design.md`, sections 3 and 4.

## Global constraints

- The class stays the source of truth for its own details, owner and roster. The class's space follows it, and no General function may change it directly: renaming, archiving, deleting, join codes, adding or removing students, and demoting the class's professor are all refused.
- Students enter an education space only through `join_class` (a class code or the invite link). They are only ever members (phase 1's `guard_student_level`).
- A co-teacher is an active faculty account (`role in ('professor','admin')`, `status = 'active'`) at level `owner` or `manager` in the class's space. `classes.professor_id` stays the one professor who owns the class. Only the admin (or the SQL console) can change it.
- The role value stays `'professor'`, and screens say Faculty.
- `supabase/*.sql` files stay idempotent. They get re-run.
- Never print or read `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` or `.env.local`.
- Do not stage `desktop.ini`, `docs/redesign/`, `.superpowers/`, `*.patch`, `graphify-out` or `verify-before-main.md`.
- Copy rules (CLAUDE.md): sentence case, active voice, no exclamation marks, no "please", no "successfully". Errors say what happened and what to do next.
- Colours come from tokens only. No raw hex.
- `npm run build` must pass before a task is called done.
- Commit messages use repo style through a heredoc (`git commit -F - <<'MSG'`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push; the controller pushes.
- `$SCRATCH` means the session scratchpad directory.

## Files

```
supabase/one-workplace.sql                 NEW  every rule in this phase, in four blocks
supabase/tests/one-workplace.test.sql      NEW
scripts/schema-drift.mjs, docs/07-backup.md       register one-workplace.sql
docs/superpowers/specs/2026-09-26-one-workplace-design.md   amendments
src/lib/general/types.ts                   GeneralSpace.kind, SpacePerson.is_student, GeneralMember.profile.role
src/lib/types.ts                           ClassRow.space_id/student_cap, JoinResult 'full'
src/lib/api/spaces.ts                      listMySpaces hides class spaces
src/lib/api/general.ts                     listGeneralMembers carries role
src/lib/api/classes.ts                     ClassInput.student_cap, JOIN_MESSAGE.full
src/pages/general/SpaceMembers.tsx, src/components/general/MembersTab.tsx   students only get "Member"
src/components/classes/ClassForm.tsx       class size limit
src/components/classes/ClassHeader.tsx     size limit shown; copy invite link
src/lib/pendingJoin.ts + pendingJoin.test.ts    NEW
src/pages/auth/JoinClassLink.tsx           NEW  /join/:code
src/App.tsx, src/pages/auth/AuthCallback.tsx, src/pages/auth/Onboarding.tsx
```

---

### Task 1: Classes get their own space

**Files:**
- Create: `supabase/one-workplace.sql` (block 1)
- Create: `supabase/tests/one-workplace.test.sql`

**Interfaces:**
- Produces (SQL):
  - enum `space_kind ('work','education')`
  - column `general_spaces.kind space_kind not null default 'work'`
  - columns `classes.space_id uuid not null unique` (FK `general_spaces`, `on delete restrict`) and `classes.student_cap int` (null, or 1–500)
  - functions `class_sync_on() → text`, `class_sync_restore(text)`, `class_syncing() → boolean`, `class_space_name(text, text) → text`
  - triggers `classes_space_create` (before insert), `classes_space_guard` (before update), `classes_space_follow` (after update or delete)
  - view `general_space_overview` gains a trailing `kind` column

- [ ] **Step 1: Write the failing test** — create `supabase/tests/one-workplace.test.sql`:

```sql
-- One workplace, phase 2: classes as spaces — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/one-workplace.test.sql
--
-- A class owns its space. Whatever happens to the class happens to the space,
-- and nothing reaches the space any other way.

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

-- Superuser, but with a caller's claims: RLS steps aside, auth.uid() still names
-- somebody, so a trigger's own rule is what gets tested.
create or replace function pg_temp.act_as_owner_for(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 56);
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

create or replace function pg_temp.must_be(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_true, false) then
    raise notice 'PASS  %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end;
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_teacher  uuid := gen_random_uuid();  -- teaches, owns the class
  v_cot      uuid := gen_random_uuid();  -- faculty, becomes a co-teacher
  v_staff    uuid := gen_random_uuid();  -- faculty, stays a plain member
  v_s1       uuid := gen_random_uuid();
  v_s2       uuid := gen_random_uuid();
  v_s3       uuid := gen_random_uuid();
  v_class    uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_user_meta_data, created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', jsonb_build_object('first_name', 'Zz', 'last_name', v.ln, 'role', v.r),
         now(), now()
    from (values
      (v_teacher, 'zz-ow-teacher@example.test', 'Teacher',  'professor'),
      (v_cot,     'zz-ow-cot@example.test',     'Coteach',  'professor'),
      (v_staff,   'zz-ow-staff@example.test',   'Staff',    'professor'),
      (v_s1,      'zz-ow-s1@example.test',      'Sone',     'student'),
      (v_s2,      'zz-ow-s2@example.test',      'Stwo',     'student'),
      (v_s3,      'zz-ow-s3@example.test',      'Sthree',   'student')
    ) as v(id, em, ln, r);

  -- Approved faculty; only the teacher may open classes.
  update public.profiles set status = 'active', can_teach = (id = v_teacher)
   where id in (v_teacher, v_cot, v_staff);

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values ('teacher', v_teacher), ('cot', v_cot), ('staff', v_staff),
    ('s1', v_s1), ('s2', v_s2), ('s3', v_s3);

  perform pg_temp.act_as(v_teacher);
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (v_teacher, 'Zz Systems Analysis', 'ZZSA', 'ZZOW-0001', 'BSIT 3A', '3rd', '1st', '2026-2027')
  returning id into v_class;
  perform pg_temp.act_as_service();
  insert into fx values ('class', v_class);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ a class makes its space

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_class   uuid := (select v from fx where k = 'class');
  v_space   uuid;
begin
  perform pg_temp.act_as_service();
  select space_id into v_space from public.classes where id = v_class;
  insert into fx values ('space', v_space);

  perform pg_temp.must_be('a new class has a space',
    v_space is not null);
  perform pg_temp.must_be('...of kind education, named for the class and section',
    (select kind = 'education' and name = 'Zz Systems Analysis · BSIT 3A'
       from public.general_spaces where id = v_space));
  perform pg_temp.must_be('...with the professor as its Owner',
    (select level = 'owner' from public.general_space_members
      where space_id = v_space and user_id = v_teacher));
end $$;

-- ------------------------------------------------------------------ every class already had one

do $$
begin
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('every class has a space',
    not exists (select 1 from public.classes where space_id is null));
  perform pg_temp.must_be('every class space is of kind education',
    not exists (select 1 from public.classes c join public.general_spaces s on s.id = c.space_id
                 where s.kind <> 'education'));
  perform pg_temp.must_be('every class professor owns the class space',
    not exists (select 1 from public.classes c
                 where not exists (select 1 from public.general_space_members m
                                    where m.space_id = c.space_id and m.user_id = c.professor_id
                                      and m.level = 'owner')));
  perform pg_temp.must_be('every active student is a member of the class space',
    not exists (select 1 from public.class_members cm join public.classes c on c.id = cm.class_id
                 where cm.status = 'active'
                   and not exists (select 1 from public.general_space_members m
                                    where m.space_id = c.space_id and m.user_id = cm.student_id)));
end $$;

-- ------------------------------------------------------------------ the space follows the class

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_cot     uuid := (select v from fx where k = 'cot');
  v_class   uuid := (select v from fx where k = 'class');
  v_space   uuid := (select v from fx where k = 'space');
begin
  perform pg_temp.act_as(v_teacher);
  update public.classes set name = 'Zz Systems Design', section = 'BSIT 3B' where id = v_class;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('renaming the class renames its space',
    (select name = 'Zz Systems Design · BSIT 3B' from public.general_spaces where id = v_space));

  perform pg_temp.act_as(v_teacher);
  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('archiving the class archives its space',
    (select archived_at is not null from public.general_spaces where id = v_space));

  perform pg_temp.act_as(v_teacher);
  update public.classes set archived_at = null where id = v_class;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('restoring the class restores its space',
    (select archived_at is null from public.general_spaces where id = v_space));

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_refuse('a professor cannot hand the class to somebody else', format(
    'update public.classes set professor_id = %L where id = %L', v_cot, v_class));
  perform pg_temp.must_refuse('a class cannot move to another space', format(
    'update public.classes set space_id = gen_random_uuid() where id = %L', v_class));

  -- Handing a class over is the SQL console's (and so the admin's) job: there is
  -- no admin update policy on classes, so it runs as the service role here.
  perform pg_temp.act_as_service();
  perform pg_temp.must_allow('the console can hand the class over', format(
    'update public.classes set professor_id = %L where id = %L', v_cot, v_class));
  perform pg_temp.must_be('...and the new professor owns the space',
    (select level = 'owner' from public.general_space_members
      where space_id = v_space and user_id = v_cot));
  perform pg_temp.must_be('...while the old one leaves it',
    not exists (select 1 from public.general_space_members
                 where space_id = v_space and user_id = v_teacher));
  update public.classes set professor_id = v_teacher where id = v_class;
  perform pg_temp.must_be('handing it back restores the first professor as Owner',
    (select level = 'owner' from public.general_space_members
      where space_id = v_space and user_id = v_teacher));
end $$;

-- ------------------------------------------------------------------ deleting the class

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_temp    uuid;
  v_space   uuid;
begin
  perform pg_temp.act_as(v_teacher);
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (v_teacher, 'Zz Throwaway', 'ZZTW', 'ZZOW-0002', 'BSIT 3A', '3rd', '1st', '2026-2027')
  returning id, space_id into v_temp, v_space;
  delete from public.classes where id = v_temp;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('deleting a class deletes its space',
    not exists (select 1 from public.general_spaces where id = v_space));
end $$;

-- ------------------------------------------------------------------ the General list can tell kinds apart

do $$
begin
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('general_space_overview carries the kind',
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'general_space_overview'
               and column_name = 'kind'));
end $$;

rollback;
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node scripts/db.mjs supabase/tests/one-workplace.test.sql`
Expected: `fixture ready`, then an error at `select space_id … from public.classes`: `column "space_id" does not exist`.

- [ ] **Step 3: Write block 1 of `supabase/one-workplace.sql`**

```sql
-- Collabify — one workplace, phase 2: every class is a space.
--
--   node scripts/db.mjs supabase/one-workplace.sql
--
-- A class keeps being the thing a professor creates, edits, archives and
-- deletes. What changes is that it now owns a space of kind 'education', and
-- the space follows it: its name, archive state, Owner and roster are written by
-- the class, never directly. The class's own tables (groups, projects, syllabus
-- weeks, submissions) are untouched; the space is where membership, levels and
-- positions live, the same way they do for a work space.
--
-- Runs after access.sql. Redefines, as supersets: the general_space_overview
-- view (general-spaces.sql), join_class (rate-limit.sql), is_class_professor and
-- the classes_select/classes_update policies (classes.sql), is_set_professor
-- (groups.sql), is_project_professor (projects.sql), is_board_professor
-- (tasks.sql), shares_class_with (removed-visible.sql), can_read_syllabus
-- (syllabus.sql), can_moderate_conversation and start_direct_conversation
-- (messages.sql), list_general_space_members and list_general_project_members
-- (general-spaces.sql). Re-run this file after re-running any of those.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- kind

do $$ begin
  create type public.space_kind as enum ('work', 'education');
exception when duplicate_object then null; end $$;

alter table public.general_spaces
  add column if not exists kind public.space_kind not null default 'work';

comment on column public.general_spaces.kind is
  'education: the space of one class, written only by the class. work: everything else.';

-- ---------------------------------------------------------------- the class's space

alter table public.classes
  add column if not exists space_id uuid references public.general_spaces (id) on delete restrict;

alter table public.classes
  add column if not exists student_cap int;

do $$ begin
  alter table public.classes add constraint classes_student_cap_sane
    check (student_cap is null or student_cap between 1 and 500);
exception when duplicate_object then null; end $$;

comment on column public.classes.student_cap is
  'Most active students the class takes. Null is no limit. join_class enforces it.';

create unique index if not exists classes_space_key on public.classes (space_id);

-- ---------------------------------------------------------------- the sync flag

/**
 * Raised while a class writes its own space, so the guards on the space step
 * aside for it and for nobody else. Transaction-local, and restored to what it
 * was rather than switched off, so one sync running inside another does not
 * open the door early for the rest of the outer one.
 */
create or replace function public.class_sync_on()
returns text language plpgsql as $$
declare
  prev text := coalesce(current_setting('collabify.class_sync', true), 'off');
begin
  perform set_config('collabify.class_sync', 'on', true);
  return prev;
end;
$$;

create or replace function public.class_sync_restore(p_prev text)
returns void language plpgsql as $$
begin
  perform set_config('collabify.class_sync', coalesce(p_prev, 'off'), true);
end;
$$;

create or replace function public.class_syncing()
returns boolean language sql stable as $$
  select coalesce(current_setting('collabify.class_sync', true), 'off') = 'on';
$$;

-- Only the triggers below raise the flag. Nobody calls these over the API.
revoke execute on function public.class_sync_on() from public, anon, authenticated;
revoke execute on function public.class_sync_restore(text) from public, anon, authenticated;

create or replace function public.class_space_name(p_name text, p_section text)
returns text language sql immutable as $$
  select left(btrim(p_name) || ' · ' || btrim(p_section), 80);
$$;

-- ---------------------------------------------------------------- creating a class

/** Before the class row lands: make its space and seat the professor as Owner. */
create or replace function public.class_space_create()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  prev text;
begin
  if new.space_id is not null then
    raise exception 'A class makes its own space' using errcode = 'check_violation';
  end if;

  prev := public.class_sync_on();
  insert into public.general_spaces (name, description, created_by, kind, archived_at)
  values (public.class_space_name(new.name, new.section), coalesce(new.description, ''),
          new.professor_id, 'education', new.archived_at)
  returning id into new.space_id;

  insert into public.general_space_members (space_id, user_id, level)
  values (new.space_id, new.professor_id, 'owner');
  perform public.class_sync_restore(prev);

  return new;
end;
$$;

drop trigger if exists classes_space_create on public.classes;
create trigger classes_space_create before insert on public.classes
  for each row execute function public.class_space_create();

-- ---------------------------------------------------------------- changing a class

/**
 * A class keeps its space for life, and only the program admin (or the SQL
 * console) hands a class to another professor. Filling space_id in for the
 * first time is the backfill below, and is the one change allowed.
 */
create or replace function public.class_space_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.space_id is not null and new.space_id is distinct from old.space_id then
    raise exception 'A class keeps its own space' using errcode = 'check_violation';
  end if;
  if new.professor_id is distinct from old.professor_id
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only the program admin hands a class to another professor'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists classes_space_guard on public.classes;
create trigger classes_space_guard before update on public.classes
  for each row execute function public.class_space_guard();

/** After the class changes or goes: its space does the same. */
create or replace function public.class_space_follow()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  prev text;
begin
  prev := public.class_sync_on();

  if tg_op = 'DELETE' then
    delete from public.general_spaces where id = old.space_id;
    perform public.class_sync_restore(prev);
    return old;
  end if;

  if new.space_id is not null and (
       new.name is distinct from old.name
       or new.section is distinct from old.section
       or new.description is distinct from old.description
       or new.archived_at is distinct from old.archived_at) then
    update public.general_spaces
       set name        = public.class_space_name(new.name, new.section),
           description = coalesce(new.description, ''),
           archived_at = new.archived_at
     where id = new.space_id;
  end if;

  if new.space_id is not null and new.professor_id is distinct from old.professor_id then
    delete from public.general_space_members
     where space_id = new.space_id and user_id = old.professor_id;
    insert into public.general_space_members (space_id, user_id, level)
    values (new.space_id, new.professor_id, 'owner')
    on conflict (space_id, user_id) do update set level = 'owner';
  end if;

  perform public.class_sync_restore(prev);
  return new;
end;
$$;

drop trigger if exists classes_space_follow on public.classes;
create trigger classes_space_follow after update or delete on public.classes
  for each row execute function public.class_space_follow();

-- ---------------------------------------------------------------- the classes that already exist

do $$
declare
  c    record;
  sid  uuid;
  prev text;
begin
  prev := public.class_sync_on();
  for c in select * from public.classes where space_id is null loop
    insert into public.general_spaces
      (name, description, created_by, kind, archived_at, created_at)
    values (public.class_space_name(c.name, c.section), coalesce(c.description, ''),
            c.professor_id, 'education', c.archived_at, c.created_at)
    returning id into sid;

    insert into public.general_space_members (space_id, user_id, level, joined_at)
    values (sid, c.professor_id, 'owner', c.created_at);

    insert into public.general_space_members (space_id, user_id, level, joined_at)
    select sid, m.student_id, 'member', m.joined_at
      from public.class_members m
     where m.class_id = c.id and m.status = 'active'
    on conflict (space_id, user_id) do nothing;

    update public.classes set space_id = sid where id = c.id;
  end loop;
  perform public.class_sync_restore(prev);
end $$;

alter table public.classes alter column space_id set not null;

-- ---------------------------------------------------------------- the General list

/** general-spaces.sql's view, with the kind on the end. Columns only ever append. */
create or replace view public.general_space_overview
with (security_invoker = true) as
select s.id,
       s.name,
       s.description,
       s.created_by,
       s.archived_at,
       s.created_at,
       s.updated_at,
       m.level as my_level,
       (select count(*) from public.general_space_members x where x.space_id = s.id)::int
         as member_count,
       (select count(*) from public.general_projects p
         where p.space_id = s.id and p.archived_at is null)::int as project_count,
       (select count(*) from public.general_projects p
         where p.space_id = s.id and p.archived_at is not null)::int as archived_count,
       s.kind
  from public.general_spaces s
  left join public.general_space_members m on m.space_id = s.id and m.user_id = auth.uid();

grant select on public.general_space_overview to authenticated;

commit;
```

- [ ] **Step 4: Apply it and run the test**

Run: `node scripts/db.mjs supabase/one-workplace.sql && node scripts/db.mjs supabase/tests/one-workplace.test.sql`
Expected: every line `PASS`, no `FAIL`.

- [ ] **Step 5: Re-run the migration to prove it is idempotent, and look at the live classes**

Run:
```bash
node scripts/db.mjs supabase/one-workplace.sql && node scripts/db.mjs -c "select c.name, s.name as space, s.kind, (select count(*) from general_space_members m where m.space_id = s.id) as members from classes c join general_spaces s on s.id = c.space_id"
```
Expected: no error. Three rows, each `education`. The Modelling and Simulation class has 16 members (15 students plus its professor), and the two archived classes have 1 each.

- [ ] **Step 6: Commit**

```bash
git add supabase/one-workplace.sql supabase/tests/one-workplace.test.sql
git commit -F - <<'MSG'
Give every class its own education space, and keep the space following the class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 2: The roster writes the space, and nothing else does

**Files:**
- Modify: `supabase/one-workplace.sql` (append block 2)
- Modify: `supabase/tests/one-workplace.test.sql` (insert sections above the final `rollback;`)

**Interfaces:**
- Consumes: `class_sync_on`, `class_sync_restore`, `class_syncing`, `classes.space_id` (Task 1); `is_student(uuid)` (access.sql).
- Produces (SQL): `is_education_space(uuid) → boolean`; triggers `class_members_sync_space`, `general_spaces_kind`, `general_space_members_class`, `general_space_invitations_class`, `general_space_join_codes_class`, `general_projects_class`.

- [ ] **Step 1: Write the failing tests** — insert above the final `rollback;`:

```sql
-- ------------------------------------------------------------------ the roster writes the space

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_s1      uuid := (select v from fx where k = 's1');
  v_class   uuid := (select v from fx where k = 'class');
  v_space   uuid := (select v from fx where k = 'space');
  v_result  text;
begin
  perform pg_temp.act_as(v_s1);
  select public.join_class('ZZOW-0001') ->> 'result' into v_result;
  perform pg_temp.must_be('a student joins the class with its code', v_result = 'joined');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and is a member of its space',
    (select level = 'member' from public.general_space_members
      where space_id = v_space and user_id = v_s1));

  perform pg_temp.act_as(v_teacher);
  update public.class_members set status = 'removed', removed_at = now(), removed_by = v_teacher
   where class_id = v_class and student_id = v_s1;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('removing a student from the roster takes them out of the space',
    not exists (select 1 from public.general_space_members
                 where space_id = v_space and user_id = v_s1));

  perform pg_temp.act_as(v_teacher);
  update public.class_members set status = 'active', removed_at = null, removed_by = null
   where class_id = v_class and student_id = v_s1;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('putting them back puts them back in the space',
    exists (select 1 from public.general_space_members
             where space_id = v_space and user_id = v_s1));
end $$;

-- ------------------------------------------------------------------ nothing else writes a class's space

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_cot     uuid := (select v from fx where k = 'cot');
  v_s1      uuid := (select v from fx where k = 's1');
  v_s2      uuid := (select v from fx where k = 's2');
  v_space   uuid := (select v from fx where k = 'space');
  v_inv     uuid;
begin
  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_refuse('a student cannot be invited into a class space', format(
    'select public.invite_to_general_space(%L, %L)', v_space, v_s2));
  perform pg_temp.must_refuse('a student cannot be removed from a class space directly', format(
    'select public.remove_general_space_member(%L, %L)', v_space, v_s1));
  perform pg_temp.must_refuse('a class space has no General join code', format(
    'select public.set_general_space_join_code(%L, true, true)', v_space));
  perform pg_temp.must_refuse('a class space is not archived from General', format(
    'select public.archive_general_space(%L, true)', v_space));
  perform pg_temp.must_refuse('a class space is not deleted from General', format(
    'select public.delete_general_space(%L)', v_space));
  perform pg_temp.act_as_owner_for(v_teacher);
  perform pg_temp.must_refuse('a class space is not renamed from General', format(
    'update public.general_spaces set name = %L where id = %L', 'Zz renamed', v_space));
  perform pg_temp.must_refuse('a class space holds no General projects', format(
    $q$select public.create_general_project('Zz project', '', null, null, null, null, %L)$q$, v_space));
  perform pg_temp.must_refuse('the professor cannot be demoted in the class space', format(
    'select public.set_general_space_level(%L, %L, %L)', v_space, v_teacher, 'manager'));
  perform pg_temp.must_refuse('a space cannot change kind', format(
    $q$update public.general_spaces set kind = 'work' where id = %L$q$, v_space));
  perform pg_temp.must_refuse('an education space cannot be made from General',
    $q$insert into public.general_spaces (name, kind) values ('Zz fake class', 'education')$q$);

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_allow('faculty can be invited into a class space', format(
    'select public.invite_to_general_space(%L, %L)', v_space, v_cot));
  perform pg_temp.act_as(v_cot);
  select id into v_inv from public.general_space_invitations
   where space_id = v_space and invitee = v_cot and status = 'pending';
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and joins it as a member',
    (select level = 'member' from public.general_space_members
      where space_id = v_space and user_id = v_cot));
end $$;
```

- [ ] **Step 2: Run to confirm the new sections fail**

Run: `node scripts/db.mjs supabase/tests/one-workplace.test.sql`
Expected: the Task 1 sections pass, then `FAIL  ...and is a member of its space`.

- [ ] **Step 3: Append block 2 to `supabase/one-workplace.sql`**

```sql
begin;

-- ---------------------------------------------------------------- the roster writes the space

/**
 * class_members stays the roster: join_class, the professor's removals and the
 * restore paths all write it, and its history (removed_at, removed_by) is what
 * recover-work.sql and removed-visible.sql read. This mirrors it into the
 * class's space, so there is one list of who is in, whichever way somebody
 * came in or left.
 */
create or replace function public.class_member_space_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sid  uuid;
  prev text;
begin
  prev := public.class_sync_on();

  if tg_op in ('UPDATE', 'DELETE') then
    select space_id into sid from public.classes where id = old.class_id;
    if sid is not null and (tg_op = 'DELETE' or new.status <> 'active') then
      delete from public.general_space_members where space_id = sid and user_id = old.student_id;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.status = 'active' then
    select space_id into sid from public.classes where id = new.class_id;
    if sid is not null then
      insert into public.general_space_members (space_id, user_id, level)
      values (sid, new.student_id, 'member')
      on conflict (space_id, user_id) do nothing;
    end if;
  end if;

  perform public.class_sync_restore(prev);
  return coalesce(new, old);
end;
$$;

drop trigger if exists class_members_sync_space on public.class_members;
create trigger class_members_sync_space
  after insert or update of status or delete on public.class_members
  for each row execute function public.class_member_space_sync();

-- ---------------------------------------------------------------- guards

create or replace function public.is_education_space(p_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.general_spaces where id = p_space and kind = 'education');
$$;

/** A space keeps its kind, and a class's space is renamed, archived and deleted by its class. */
create or replace function public.guard_space_kind()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.class_syncing() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if new.kind = 'education' then
      raise exception 'Open a class to make an education space.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    raise exception 'A space keeps the kind it was made with.' using errcode = 'check_violation';
  end if;

  if old.kind = 'education' then
    if tg_op = 'DELETE' then
      raise exception 'Delete the class instead. Its space goes with it.'
        using errcode = 'check_violation';
    end if;
    if new.name is distinct from old.name or new.archived_at is distinct from old.archived_at then
      raise exception 'Rename or archive the class instead. Its space follows.'
        using errcode = 'check_violation';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists general_spaces_kind on public.general_spaces;
create trigger general_spaces_kind before insert or update or delete on public.general_spaces
  for each row execute function public.guard_space_kind();

/**
 * Who sits in a class's space. Students arrive and leave through the roster.
 * The class's professor stays its Owner until the admin hands the class over.
 * Faculty (co-teachers) come and go the General way.
 */
create or replace function public.guard_class_space_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sid  uuid := case when tg_op = 'DELETE' then old.space_id else new.space_id end;
  prof uuid;
begin
  if auth.uid() is null or public.class_syncing() or not public.is_education_space(sid) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select professor_id into prof from public.classes where space_id = sid;

  if tg_op = 'INSERT' and public.is_student(new.user_id) then
    raise exception 'Students join a class with its class code.' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' and public.is_student(old.user_id) then
    raise exception 'Remove a student from the class roster instead.'
      using errcode = 'check_violation';
  end if;
  if (tg_op = 'DELETE' and old.user_id = prof)
     or (tg_op = 'UPDATE' and old.user_id = prof and new.level <> 'owner') then
    raise exception 'The class''s professor stays its Owner. The program admin can hand the class over.'
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists general_space_members_class on public.general_space_members;
create trigger general_space_members_class
  before insert or update of level or delete on public.general_space_members
  for each row execute function public.guard_class_space_member();

/** The side doors: invitations for students, General join codes, General projects. */
create or replace function public.guard_class_space_side()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.class_syncing()
     or new.space_id is null or not public.is_education_space(new.space_id) then
    return new;
  end if;

  if tg_table_name = 'general_space_invitations' then
    if public.is_student(new.invitee) then
      raise exception 'Students join a class with its class code.'
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'general_space_join_codes' then
    raise exception 'A class uses its class code. Share that instead.'
      using errcode = 'check_violation';
  elsif tg_table_name = 'general_projects' then
    raise exception 'Make class projects from the class itself.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists general_space_invitations_class on public.general_space_invitations;
create trigger general_space_invitations_class before insert on public.general_space_invitations
  for each row execute function public.guard_class_space_side();

drop trigger if exists general_space_join_codes_class on public.general_space_join_codes;
create trigger general_space_join_codes_class before insert or update on public.general_space_join_codes
  for each row execute function public.guard_class_space_side();

drop trigger if exists general_projects_class on public.general_projects;
create trigger general_projects_class before insert or update of space_id on public.general_projects
  for each row execute function public.guard_class_space_side();

commit;
```

- [ ] **Step 4: Apply and run**

Run: `node scripts/db.mjs supabase/one-workplace.sql && node scripts/db.mjs supabase/tests/one-workplace.test.sql`
Expected: every line `PASS`.

If one of the General-function refusals passes for a different reason than the guard (for example `archive_general_space` refusing on rights), that's still a refusal. Leave it, and note it in the report.

- [ ] **Step 5: Commit**

```bash
git add supabase/one-workplace.sql supabase/tests/one-workplace.test.sql
git commit -F - <<'MSG'
Let the class roster write the class's space, and refuse every other way in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 3: Co-teachers pass the teaching checks

**Files:**
- Modify: `supabase/one-workplace.sql` (append block 3)
- Modify: `supabase/tests/one-workplace.test.sql` (insert above the final `rollback;`)

**Interfaces:**
- Consumes: `classes.space_id` (Task 1); the co-teacher fixture from Task 2's tests (`cot` is a member of the class space).
- Produces (SQL): `is_class_professor(uuid)` accepts co-teachers. `is_set_professor`, `is_project_professor`, `is_board_professor`, `can_read_syllabus`, `can_moderate_conversation`, `start_direct_conversation` and `shares_class_with` go through it. The `classes_select` and `classes_update` policies use it. `classes_delete` stays owner-only.

- [ ] **Step 1: Write the failing tests** — insert above the final `rollback;`:

```sql
-- ------------------------------------------------------------------ co-teachers

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_cot     uuid := (select v from fx where k = 'cot');
  v_staff   uuid := (select v from fx where k = 'staff');
  v_s1      uuid := (select v from fx where k = 's1');
  v_class   uuid := (select v from fx where k = 'class');
  v_space   uuid := (select v from fx where k = 'space');
  v_set     uuid;
  v_convo   uuid;
  v_inv     uuid;
begin
  perform pg_temp.act_as(v_teacher);
  insert into public.group_sets (class_id, name, mode, default_limit)
  values (v_class, 'Zz teams', 'manual', 5) returning id into v_set;

  -- Staff comes in as a plain member; the co-teacher is raised to Manager.
  perform public.invite_to_general_space(v_space, v_staff);
  perform pg_temp.act_as(v_staff);
  select id into v_inv from public.general_space_invitations
   where space_id = v_space and invitee = v_staff and status = 'pending';
  perform public.respond_general_space_invitation(v_inv, true);

  perform pg_temp.act_as(v_cot);
  perform pg_temp.must_be('a faculty member of the class space is not a co-teacher yet',
    not public.is_class_professor(v_class));

  perform pg_temp.act_as(v_teacher);
  perform public.set_general_space_level(v_space, v_cot, 'manager');

  perform pg_temp.act_as(v_cot);
  perform pg_temp.must_be('a Manager of the class space is a co-teacher',
    public.is_class_professor(v_class));
  perform pg_temp.must_be('...who reads the class',
    exists (select 1 from public.classes where id = v_class));
  perform pg_temp.must_be('...runs its group sets',
    public.is_set_professor(v_set));
  perform pg_temp.must_be('...sees its students',
    public.shares_class_with(v_s1));
  select id into v_convo from public.conversations where class_id = v_class limit 1;
  perform pg_temp.must_be('...and moderates its conversation',
    public.can_moderate_conversation(v_convo));
  update public.classes set description = 'Zz edited by the co-teacher' where id = v_class;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a co-teacher can edit the class',
    (select description = 'Zz edited by the co-teacher' from public.classes where id = v_class));

  perform pg_temp.act_as(v_cot);
  delete from public.classes where id = v_class;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a co-teacher cannot delete the class',
    exists (select 1 from public.classes where id = v_class));

  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_be('a faculty Member of the space is not a co-teacher',
    not public.is_class_professor(v_class));
  update public.classes set description = 'Zz edited by staff' where id = v_class;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and cannot edit the class',
    (select description = 'Zz edited by the co-teacher' from public.classes where id = v_class));

  perform pg_temp.act_as(v_s1);
  perform pg_temp.must_be('a student is never a co-teacher', not public.is_class_professor(v_class));
  perform pg_temp.must_be('...but sees the co-teacher', public.shares_class_with(v_cot));
end $$;
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node scripts/db.mjs supabase/tests/one-workplace.test.sql`
Expected: earlier sections pass, then `FAIL  a Manager of the class space is a co-teacher`.

- [ ] **Step 3: Append block 3 to `supabase/one-workplace.sql`**

```sql
begin;

-- ---------------------------------------------------------------- co-teachers

/**
 * Who teaches a class: its professor, or active faculty the class's space holds
 * at Owner or Manager. Every check below that used to compare professor_id with
 * the caller now asks this instead, so a co-teacher is never half let in.
 */
create or replace function public.is_class_professor(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.classes c
     where c.id = p_class
       and (c.professor_id = auth.uid()
            or exists (
              select 1
                from public.general_space_members m
                join public.profiles p on p.id = m.user_id
               where m.space_id = c.space_id
                 and m.user_id = auth.uid()
                 and m.level in ('owner', 'manager')
                 and p.role in ('professor', 'admin')
                 and p.status = 'active'))
  );
$$;

create or replace function public.is_set_professor(p_set uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_sets s
     where s.id = p_set and public.is_class_professor(s.class_id)
  );
$$;

create or replace function public.is_project_professor(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
     where p.id = p_project and public.is_class_professor(p.class_id)
  );
$$;

create or replace function public.is_board_professor(p_board uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_boards b
      join public.projects p on p.id = b.project_id
     where b.id = p_board and public.is_class_professor(p.class_id)
  );
$$;

create or replace function public.can_read_syllabus(p_resource uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.classes c
      left join public.class_members m
        on m.class_id = c.id and m.student_id = auth.uid() and m.status = 'active'
     where c.syllabus_id = p_resource
       and c.archived_at is null
       and (public.is_class_professor(c.id) or m.student_id is not null)
  );
$$;

create or replace function public.can_moderate_conversation(p_conversation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.conversations c
      left join public.classes cl on cl.id = c.class_id
      left join public.groups g on g.id = c.group_id
      left join public.group_sets gs on gs.id = g.set_id
     where c.id = p_conversation
       and public.is_class_professor(coalesce(cl.id, gs.class_id))
  );
$$;

/**
 * removed-visible.sql's version, plus co-teachers: they see the class's
 * students, and the class's students see them.
 */
create or replace function public.shares_class_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.class_members me
      join public.class_members them on them.class_id = me.class_id
      join public.classes c on c.id = me.class_id
     where me.student_id = auth.uid() and me.status = 'active'
       and them.student_id = p_user and them.status = 'active'
       and c.archived_at is null
    union all
    select 1
      from public.classes c
      join public.class_members m on m.class_id = c.id
     where (public.is_class_professor(c.id) and m.student_id = p_user)
        or (c.professor_id = p_user and m.student_id = auth.uid() and m.status = 'active')
    union all
    select 1
      from public.classes c
      join public.general_space_members staff
        on staff.space_id = c.space_id and staff.level in ('owner', 'manager')
     where staff.user_id = p_user
       and (public.is_class_professor(c.id)
            or exists (select 1 from public.class_members m
                        where m.class_id = c.id and m.student_id = auth.uid()
                          and m.status = 'active'))
  );
$$;

/** messages.sql's version: any teacher of the student's class may start the thread. */
create or replace function public.start_direct_conversation(p_student uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  key   text;
  convo uuid;
begin
  if me is null then
    return jsonb_build_object('result', 'not_signed_in');
  end if;
  if not exists (select 1 from public.profiles where id = me and role = 'professor') then
    return jsonb_build_object('result', 'not_professor');
  end if;

  -- The student must actually be in one of the classes this person teaches.
  if not exists (
    select 1 from public.class_members m
     where m.student_id = p_student and m.status = 'active'
       and public.is_class_professor(m.class_id)
  ) then
    return jsonb_build_object('result', 'not_your_student');
  end if;

  key := least(me::text, p_student::text) || '|' || greatest(me::text, p_student::text);

  select id into convo from public.conversations where direct_key = key and kind = 'direct';
  if convo is null then
    insert into public.conversations (kind, direct_key) values ('direct', key)
    returning id into convo;
    insert into public.conversation_members (conversation_id, user_id)
    values (convo, me), (convo, p_student);
  end if;

  return jsonb_build_object('result', 'ok', 'conversation_id', convo);
end;
$$;

/** classes.sql's policies, through the helper. Deleting a class stays the professor's alone. */
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes
  for select using (
    public.is_class_professor(id)
    or public.is_admin()
    or (archived_at is null and public.is_active_member(id))
  );

drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes
  for update using (public.is_class_professor(id)) with check (public.is_class_professor(id));

commit;
```

- [ ] **Step 4: Apply and run**

Run: `node scripts/db.mjs supabase/one-workplace.sql && node scripts/db.mjs supabase/tests/one-workplace.test.sql`
Expected: every line `PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/one-workplace.sql supabase/tests/one-workplace.test.sql
git commit -F - <<'MSG'
Let faculty at Owner or Manager in a class's space teach it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 4: Class size limit, and member lists that say who is a student

**Files:**
- Modify: `supabase/one-workplace.sql` (append block 4)
- Modify: `supabase/tests/one-workplace.test.sql` (insert above the final `rollback;`)

**Interfaces:**
- Consumes: `classes.student_cap` (Task 1).
- Produces (SQL): `join_class(text)` returns `{"result":"full"}` when the class is at its cap. `list_general_space_members(uuid)` and `list_general_project_members(uuid)` gain a trailing `is_student boolean` column.

- [ ] **Step 1: Write the failing tests** — insert above the final `rollback;`:

```sql
-- ------------------------------------------------------------------ class size limit

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_s2      uuid := (select v from fx where k = 's2');
  v_s3      uuid := (select v from fx where k = 's3');
  v_class   uuid := (select v from fx where k = 'class');
  v_result  text;
begin
  -- s1 is already in; a cap of 1 means the class is full.
  perform pg_temp.act_as(v_teacher);
  update public.classes set student_cap = 1 where id = v_class;

  perform pg_temp.act_as(v_s2);
  select public.join_class('ZZOW-0001') ->> 'result' into v_result;
  perform pg_temp.must_be('a full class turns a new student away', v_result = 'full');

  perform pg_temp.act_as(v_teacher);
  update public.classes set student_cap = null where id = v_class;

  perform pg_temp.act_as(v_s2);
  select public.join_class('ZZOW-0001') ->> 'result' into v_result;
  perform pg_temp.must_be('with no limit the same student gets in', v_result = 'joined');

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_refuse('a limit of zero is refused', format(
    'update public.classes set student_cap = 0 where id = %L', v_class));
end $$;

-- ------------------------------------------------------------------ member lists say who is a student

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_s1      uuid := (select v from fx where k = 's1');
  v_space   uuid := (select v from fx where k = 'space');
begin
  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_be('the space member list marks students',
    (select is_student from public.list_general_space_members(v_space) where user_id = v_s1));
  perform pg_temp.must_be('...and not faculty',
    (select not is_student from public.list_general_space_members(v_space) where user_id = v_teacher));
  perform pg_temp.must_be('the project member list has the same column',
    exists (select 1 from pg_proc p
             where p.proname = 'list_general_project_members'
               and 'is_student' = any (p.proargnames)));
end $$;
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node scripts/db.mjs supabase/tests/one-workplace.test.sql`
Expected: `FAIL  a full class turns a new student away`.

- [ ] **Step 3: Append block 4 to `supabase/one-workplace.sql`**

```sql
begin;

-- ---------------------------------------------------------------- class size limit

/** rate-limit.sql's join_class, plus the class's size limit. */
create or replace function public.join_class(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target   public.classes%rowtype;
  caller   public.profiles%rowtype;
  existing public.class_members%rowtype;
begin
  select * into caller from public.profiles where id = auth.uid();
  if not found then
    return jsonb_build_object('result', 'not_signed_in');
  end if;
  if caller.role is distinct from 'student' then
    return jsonb_build_object('result', 'not_student');
  end if;

  -- Counted before the code is read, so a wrong guess costs an attempt.
  if not public.rate_limit_ok('class_join', 10, interval '1 hour') then
    return jsonb_build_object('result', 'too_many');
  end if;

  select * into target from public.classes where upper(code) = upper(trim(p_code));
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if target.archived_at is not null then
    return jsonb_build_object('result', 'archived');
  end if;

  select * into existing from public.class_members
   where class_id = target.id and student_id = caller.id;

  if found and existing.status = 'removed' then
    return jsonb_build_object('result', 'blocked');
  end if;
  if found then
    return jsonb_build_object('result', 'already_member', 'class_id', target.id);
  end if;
  if not target.join_open then
    return jsonb_build_object('result', 'closed');
  end if;
  if target.student_cap is not null and (
       select count(*) from public.class_members
        where class_id = target.id and status = 'active'
     ) >= target.student_cap then
    return jsonb_build_object('result', 'full');
  end if;

  insert into public.class_members (class_id, student_id) values (target.id, caller.id);
  return jsonb_build_object('result', 'joined', 'class_id', target.id);
end;
$$;

-- ---------------------------------------------------------------- who is a student

/**
 * general-spaces.sql's member lists, plus is_student, so the level pickers can
 * stop offering Owner and Manager for a student. A changed column list needs a
 * drop, not a replace.
 */
drop function if exists public.list_general_space_members(uuid);
create function public.list_general_space_members(p_space uuid)
returns table (user_id uuid, first_name text, last_name text, avatar_url text,
               level public.general_level, joined_at timestamptz, is_student boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_general_space_member(p_space) then
    raise exception 'You are not in this space' using errcode = 'insufficient_privilege';
  end if;

  return query
    select m.user_id, pr.first_name, pr.last_name, pr.avatar_url, m.level, m.joined_at,
           pr.role = 'student'
      from public.general_space_members m
      join public.profiles pr on pr.id = m.user_id
     where m.space_id = p_space
     order by m.level, pr.last_name, pr.first_name;
end;
$$;

drop function if exists public.list_general_project_members(uuid);
create function public.list_general_project_members(p_project uuid)
returns table (user_id uuid, first_name text, last_name text, avatar_url text,
               level public.general_level, joined_at timestamptz, is_student boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.can_read_general_project(p_project) then
    raise exception 'You cannot see this project' using errcode = 'insufficient_privilege';
  end if;

  return query
    select m.user_id, pr.first_name, pr.last_name, pr.avatar_url, m.level, m.joined_at,
           pr.role = 'student'
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project
     order by m.level, pr.last_name, pr.first_name;
end;
$$;

revoke execute on function public.list_general_space_members(uuid) from public, anon;
revoke execute on function public.list_general_project_members(uuid) from public, anon;
grant execute on function public.list_general_space_members(uuid) to authenticated, service_role;
grant execute on function public.list_general_project_members(uuid) to authenticated, service_role;

commit;
```

- [ ] **Step 4: Apply and run**

Run: `node scripts/db.mjs supabase/one-workplace.sql && node scripts/db.mjs supabase/tests/one-workplace.test.sql`
Expected: every line `PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/one-workplace.sql supabase/tests/one-workplace.test.sql
git commit -F - <<'MSG'
Cap a class's size, and mark students in the member lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 5: Register the file and bring the existing suites and docs in line

**Files:**
- Modify: `scripts/schema-drift.mjs:32`, `docs/07-backup.md`, `docs/superpowers/specs/2026-09-26-one-workplace-design.md`
- Modify (only if a suite fails because of a fixture): files under `supabase/tests/`

- [ ] **Step 1: Run every suite**

Run:
```bash
for f in supabase/tests/*.test.sql; do out=$(node scripts/db.mjs "$f" 2>&1); if echo "$out" | grep -qE "FAIL  |SQL failed|ERROR:"; then echo "✗ $f: $(echo "$out" | grep -m1 -E "FAIL  |SQL failed|ERROR:")"; else echo "✓ $f"; fi; done
```
Expected: 39 files. Each `✓`, or a `✗` you can explain.

- [ ] **Step 2: Fix fixture-caused failures only**

These are the likely causes, each fixed in the test's fixture and never in `one-workplace.sql`:
- A suite inserts a class as an account that is not teaching faculty. The class trigger now creates a space, so `guard_general_creator` refuses. Give that professor `status = 'active'` and `can_teach = true` in the fixture, as the service role.
- A suite changes `classes.professor_id` while acting as a non-admin user. Do that update as the service role instead.
- A suite writes `general_space_members` for a class space directly.

List every edit in the report. If a failure is not fixture-caused, stop and report NEEDS_CONTEXT with the suite name and the exact line.

- [ ] **Step 3: Register `one-workplace.sql`**

`scripts/schema-drift.mjs:32`: append ` one-workplace` after ` access` inside the ORDER string.

`docs/07-backup.md`: append ` supabase/one-workplace.sql` to the end of the restore command. After the `access.sql` paragraph, add:

```markdown
`one-workplace.sql` runs after `access.sql`. It gives every class an education
space and redefines, as supersets, the `general_space_overview` view and the
member lists (`general-spaces.sql`), `join_class` (`rate-limit.sql`),
`is_class_professor` and the class policies (`classes.sql`), the teaching
helpers in `groups.sql`, `projects.sql`, `tasks.sql`, `syllabus.sql`,
`removed-visible.sql` and `messages.sql`. Re-run it after any of those. Re-running
`general-spaces.sql` alone fails on the view ("cannot drop columns from view")
until `one-workplace.sql` runs again.
```

- [ ] **Step 4: Amend the spec to match what was built**

In `docs/superpowers/specs/2026-09-26-one-workplace-design.md`, section 3:
- Replace the `create_education_space(...)` bullet with: "Creating a class creates its space: a trigger on `classes` inserts `general_spaces(kind='education')` and the Owner membership in the same statement, so the class form, its API and every other insert path need no change. Phase 3's New space dialog creates an education space by creating a class."
- Replace the "Membership:" bullet with: "Membership: `class_members` stays the roster and the only thing that adds or removes a student. A trigger mirrors it into `general_space_members`, which is the one list of who is in. Guards refuse every other way of changing a class's space (General invitations for students, join codes, direct removal, renaming, archiving, deleting, General projects, demoting the class's professor). `join_class` enforces the cap."
- After the `is_class_professor` bullet, add: "The co-teacher checks are in the database from phase 2. The screens that list a professor's classes still filter on `professor_id`, so co-teachers see co-taught classes in phase 3, when the space becomes the page."

In section 4, phase 2: replace "`create_education_space`, dual-write join and remove" with "the class-to-space triggers, the roster mirror and the space guards", and add "member lists that mark students".

- [ ] **Step 5: Re-run everything and commit**

Run the Step 1 loop again (all `✓`) and `node scripts/schema-drift.mjs | tail -2` (no crash).

```bash
git add scripts/schema-drift.mjs docs/07-backup.md docs/superpowers/specs/2026-09-26-one-workplace-design.md supabase/tests
git commit -F - <<'MSG'
Register one-workplace.sql and match the spec to how classes became spaces

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 6: The screens today keep working, and know about kinds, caps and students

**Files:**
- Modify: `src/lib/general/types.ts`, `src/lib/types.ts`, `src/lib/api/spaces.ts`, `src/lib/api/general.ts`, `src/lib/api/classes.ts`, `src/pages/general/SpaceMembers.tsx`, `src/components/general/MembersTab.tsx`, `src/components/classes/ClassForm.tsx`, `src/components/classes/ClassHeader.tsx`

**Interfaces:**
- Consumes (SQL): `general_space_overview.kind`, `list_general_*_members(...).is_student`, `classes.space_id`, `classes.student_cap`, `join_class` result `'full'`.
- Produces (TS): `GeneralSpace.kind: 'work' | 'education'`; `SpacePerson.is_student: boolean`; `GeneralMember.profile` carries `role: Role | null`; `ClassRow.space_id: string`; `ClassRow.student_cap: number | null`; `ClassInput.student_cap?: number | null`; `JoinResult` includes `'full'`.

- [ ] **Step 1: Types**

`src/lib/general/types.ts`, in `GeneralSpace` after `id: string`:
```ts
  /** education: a class's space, written only by the class. Shown in phase 3. */
  kind: 'work' | 'education'
```
In `SpacePerson`, after `joined_at: string`:
```ts
  /** Students only ever hold Member, so the level pickers offer nothing else. */
  is_student: boolean
```
In `GeneralMember`, change the `profile` line to:
```ts
  profile: (Person & { status: AccountStatus; role: Role | null }) | null
```
and import `Role` from `'../types'` alongside `AccountStatus` (match however `AccountStatus` is imported there).

`src/lib/types.ts`, in `ClassRow` after `school_year: string`:
```ts
  /** The class's education space. Every class has one. */
  space_id: string
  /** Most active students it takes. Null is no limit. */
  student_cap: number | null
```
Add `| 'full'` to `JoinResult`, after `'closed'`.

`src/lib/api/classes.ts`: add `student_cap?: number | null` as the last field of `ClassInput`, and add to `JOIN_MESSAGE` after `closed`:
```ts
  full: 'That class is full. Ask your professor to raise its size limit.',
```

- [ ] **Step 2: Hide class spaces from General until phase 3** — `src/lib/api/spaces.ts`, `listMySpaces`:

```ts
export async function listMySpaces() {
  // Class spaces run through the class pages until phase 3 makes the space the page.
  const { data, error } = await supabase
    .from('general_space_overview')
    .select('*')
    .eq('kind', 'work')
    .order('name')
  if (error) throw error
  return (data ?? []) as GeneralSpaceSummary[]
}
```

- [ ] **Step 3: Project members carry the role** — `src/lib/api/general.ts`, `listGeneralMembers`:
- Change the select to `` `project_id, user_id, level, joined_at, profile:profiles (${PERSON}, status, role)` ``.
- In the fallback object built from `list_general_project_members`, add `role: hit.is_student ? ('student' as const) : null,` after `status: 'active' as const,`.

- [ ] **Step 4: Level pickers offer students nothing but Member**

`src/pages/general/SpaceMembers.tsx`, in the `<Select … options={LEVELS} …/>` for a member, replace `options={LEVELS}` with:
```tsx
                      options={m.is_student ? LEVELS.filter((l) => l.value === 'member') : LEVELS}
```

`src/components/general/MembersTab.tsx`, change the level `Select`'s `options` filter to:
```tsx
                    options={LEVELS.filter(
                      (l) =>
                        (l.value === m.level || canStepDown(m.level, state.ownerCount)) &&
                        (m.profile?.role !== 'student' || l.value === 'member'),
                    ).map((l) => ({ value: l.value, label: l.label }))}
```

- [ ] **Step 5: Class size limit in the class form** — `src/components/classes/ClassForm.tsx`

State, after the `curriculumId` state:
```tsx
  const [cap, setCap] = useState(defaults?.student_cap ? String(defaults.student_cap) : '')
```
In `submit`, add as the last field of the object:
```tsx
      student_cap: cap.trim() ? Number(cap) : null,
```
Directly before `<Field label="Description" optional>`, add:
```tsx
      <Field
        label="Class size limit"
        optional
        hint={<span className="text-[12px] text-faint">Leave empty for no limit</span>}
      >
        {(id) => (
          <Input
            id={id}
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            placeholder="40"
          />
        )}
      </Field>
```
If `Field` doesn't accept `optional` together with `hint`, keep `optional` and move the hint text into `placeholder="No limit"`. Report it.

- [ ] **Step 6: Show the limit on the class header** — `src/components/classes/ClassHeader.tsx`, the Roster `<dd>` text becomes:

```tsx
                  {cls.student_count}
                  {cls.student_cap ? ` of ${cls.student_cap}` : ''}{' '}
                  {(cls.student_cap ?? cls.student_count) === 1 ? 'student' : 'students'}
```

- [ ] **Step 7: Build and test**

Run: `npm run build && npx vitest run`
Expected: build succeeds (tsc lists any other place that builds a `GeneralMember.profile`, `SpacePerson` or `ClassRow` literally; fix each minimally and list it), and every test passes.

- [ ] **Step 8: Commit**

```bash
git add src/lib src/pages/general/SpaceMembers.tsx src/components/general/MembersTab.tsx src/components/classes/ClassForm.tsx src/components/classes/ClassHeader.tsx
git commit -F - <<'MSG'
Keep class spaces out of General for now, cap class size, and offer students only Member

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 7: Join a class from a link

**Files:**
- Create: `src/lib/pendingJoin.ts`, `src/lib/pendingJoin.test.ts`, `src/pages/auth/JoinClassLink.tsx`
- Modify: `src/App.tsx`, `src/pages/auth/AuthCallback.tsx`, `src/pages/auth/Onboarding.tsx`, `src/components/classes/ClassHeader.tsx`

**Interfaces:**
- Consumes: `joinClass(code)`, `JOIN_MESSAGE` (`src/lib/api/classes.ts`); `useAuth()`.
- Produces: `normalizeCode(code: string): string`, `joinPath(code: string): string`, `inviteLink(code: string, origin: string): string`, `rememberJoin(code: string, s?: KeyStore): void`, `pendingJoin(s?: KeyStore): string | null`, `forgetJoin(s?: KeyStore): void`, and `type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>`, all from `src/lib/pendingJoin.ts`. Adds the public route `/join/:code`.

- [ ] **Step 1: Write the failing test** — `src/lib/pendingJoin.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { forgetJoin, inviteLink, joinPath, normalizeCode, pendingJoin, rememberJoin } from './pendingJoin'
import type { KeyStore } from './pendingJoin'

function memory(): KeyStore {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

describe('class invite links', () => {
  it('reads a code the way join_class does', () => {
    expect(normalizeCode('  dbm-7823 ')).toBe('DBM-7823')
  })

  it('builds the path and the link', () => {
    expect(joinPath('dbm-7823')).toBe('/join/DBM-7823')
    expect(inviteLink('dbm-7823', 'https://collabify.app')).toBe('https://collabify.app/join/DBM-7823')
  })

  it('keeps a code across the sign-in detour, once', () => {
    const s = memory()
    expect(pendingJoin(s)).toBeNull()
    rememberJoin('dbm-7823', s)
    expect(pendingJoin(s)).toBe('DBM-7823')
    forgetJoin(s)
    expect(pendingJoin(s)).toBeNull()
  })

  it('does nothing when there is no storage', () => {
    expect(() => rememberJoin('x', undefined)).not.toThrow()
    expect(pendingJoin(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/pendingJoin.test.ts`
Expected: FAIL, `Failed to resolve import "./pendingJoin"`.

- [ ] **Step 3: Write `src/lib/pendingJoin.ts`**

```ts
/**
 * A class invite link, and the code it carries across signing in.
 *
 * Somebody who opens /join/ABC-1234 signed out has to register or sign in
 * first, and the email confirmation can land in a different tab. The code waits
 * in localStorage until the first page that can use it does. It is a class
 * code, which the class already shows to everybody in it, so nothing secret
 * is kept.
 */
export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const KEY = 'collabify.pendingJoin'

function browserStore(): KeyStore | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function normalizeCode(code: string) {
  return code.trim().toUpperCase()
}

export function joinPath(code: string) {
  return `/join/${encodeURIComponent(normalizeCode(code))}`
}

export function inviteLink(code: string, origin: string) {
  return `${origin}${joinPath(code)}`
}

export function rememberJoin(code: string, s: KeyStore | undefined = browserStore()) {
  try {
    s?.setItem(KEY, normalizeCode(code))
  } catch {
    // Private windows and blocked storage: the link just has to be opened again.
  }
}

export function pendingJoin(s: KeyStore | undefined = browserStore()): string | null {
  try {
    return s?.getItem(KEY) || null
  } catch {
    return null
  }
}

export function forgetJoin(s: KeyStore | undefined = browserStore()) {
  try {
    s?.removeItem(KEY)
  } catch {
    // Nothing to forget.
  }
}
```

Note: the test's `rememberJoin('x', undefined)` passes `undefined` explicitly. A default parameter applies when the argument is `undefined`, so in node it falls back to `browserStore()`, which returns `undefined` because `window` is not defined. The test holds either way.

- [ ] **Step 4: Run it**

Run: `npx vitest run src/lib/pendingJoin.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: The link page** — `src/pages/auth/JoinClassLink.tsx`

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Icon'
import { useAuth } from '../../context/AuthContext'
import { JOIN_MESSAGE, joinClass } from '../../lib/api/classes'
import { authErrorMessage } from '../../lib/authError'
import { forgetJoin, rememberJoin } from '../../lib/pendingJoin'
import { homeFor } from '../../lib/workplace'

/**
 * /join/:code — a class invite link.
 *
 * Signed out, it keeps the code and sends somebody to sign in; AuthCallback and
 * Onboarding bring them back here. Signed in as a student, it joins and opens
 * the class. Anyone else is told the link is for students.
 */
export default function JoinClassLink() {
  const { code = '' } = useParams()
  const { ready, session, profile } = useAuth()
  const navigate = useNavigate()
  const [message, setMessage] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (!ready || started.current) return
    if (!session) {
      rememberJoin(code)
      navigate('/login', { replace: true })
      return
    }
    if (!profile) {
      rememberJoin(code)
      navigate('/onboarding', { replace: true })
      return
    }
    started.current = true
    forgetJoin()
    if (profile.role !== 'student') {
      setMessage('Class links are for student accounts. Faculty open classes from their own dashboard.')
      return
    }
    void (async () => {
      try {
        const { result, class_id } = await joinClass(code)
        if ((result === 'joined' || result === 'already_member') && class_id) {
          navigate(`/student/classes/${class_id}`, { replace: true })
          return
        }
        setMessage(result === 'joined' ? 'You joined the class.' : JOIN_MESSAGE[result])
      } catch (err) {
        setMessage(authErrorMessage(err, 'Could not join that class.'))
      }
    })()
  }, [ready, session, profile, code, navigate])

  return (
    <AuthLayout title="Joining your class" subtitle={`Class code ${code.toUpperCase()}`}>
      {message ? (
        <div className="space-y-4">
          <Alert tone="error">{message}</Alert>
          <Link
            to={profile ? homeFor(profile) : '/login'}
            className="block rounded-xl border border-line px-4 py-3 text-center text-[14px] font-medium text-ink transition-colors hover:bg-[var(--surface-sunken)]"
          >
            Go to your dashboard
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-[14px] text-muted">
          <Spinner size={16} />
          Opening the class…
        </div>
      )}
    </AuthLayout>
  )
}
```

`src/App.tsx`: add `const JoinClassLink = lazy(() => import('./pages/auth/JoinClassLink'))` beside the other lazy auth pages, and add `<Route path="/join/:code" element={<JoinClassLink />} />` directly after the `/pending` route (public, outside every `ProtectedRoute`). If the other public auth routes aren't lazy, import it the same way they are.

- [ ] **Step 6: Bring people back after signing in**

`src/pages/auth/AuthCallback.tsx`: import `{ joinPath, pendingJoin }` from `'../../lib/pendingJoin'`, and replace `navigate(homeFor(profile), { replace: true })` with:

```tsx
    const waiting = profile ? pendingJoin() : null
    navigate(waiting ? joinPath(waiting) : homeFor(profile), { replace: true })
```

`src/pages/auth/Onboarding.tsx`: import `{ joinPath, pendingJoin }` from `'../../lib/pendingJoin'`, and change the navigate after `completeOnboarding` to:

```tsx
      const waiting = role === 'student' ? pendingJoin() : null
      navigate(waiting ? joinPath(waiting) : role === 'professor' ? '/pending' : '/student', {
        replace: true,
      })
```

- [ ] **Step 7: Let the class's teacher copy the link** — `src/components/classes/ClassHeader.tsx`

Import `{ inviteLink }` from `'../../lib/pendingJoin'`. Add state `const [linkCopied, setLinkCopied] = useState(false)` and:

```tsx
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink(cls.code, window.location.origin))
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1800)
    } catch {
      show('Could not copy. Share the class code instead.', 'error')
    }
  }
```

Inside the "Class code" `<dd>`, after the code `<button>`, add:

```tsx
                  {canManage && (
                    <button
                      type="button"
                      onClick={copyLink}
                      className="mt-1.5 flex items-center gap-1.5 text-[12px] text-amber-50/60 transition-colors hover:text-amber-50"
                    >
                      <Icon name={linkCopied ? 'check' : 'copy'} size={13} />
                      {linkCopied ? 'Invite link copied' : 'Copy invite link'}
                    </button>
                  )}
```

- [ ] **Step 8: Build and test**

Run: `npm run build && npx vitest run`
Expected: build succeeds; every test passes, including the 4 new ones.

- [ ] **Step 9: Commit**

```bash
git add src/lib/pendingJoin.ts src/lib/pendingJoin.test.ts src/pages/auth/JoinClassLink.tsx src/App.tsx src/pages/auth/AuthCallback.tsx src/pages/auth/Onboarding.tsx src/components/classes/ClassHeader.tsx
git commit -F - <<'MSG'
Join a class from an invite link, even through signing up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 8: Verification

**Files:** none changed unless a check fails.

- [ ] **Step 1: Full checks**

Run: `npm run build && npx vitest run && node scripts/schema-drift.mjs | tail -2`, then the SQL loop from Task 5 Step 1.
Expected: all green, 39 SQL files `✓`.

- [ ] **Step 2: Live data**

Run:
```bash
node scripts/db.mjs -c "select (select count(*) from classes where space_id is null) as classes_without_space, (select count(*) from general_spaces where kind = 'education') as class_spaces, (select count(*) from class_members cm join classes c on c.id = cm.class_id where cm.status = 'active' and not exists (select 1 from general_space_members m where m.space_id = c.space_id and m.user_id = cm.student_id)) as students_missing_from_space"
```
Expected: `0`, `3`, `0`.

- [ ] **Step 3: Browser walk (needs the owner to sign in)**

Start the dev server with `preview_start` (`collabify`). Ask the owner to sign in for each check below, one at a time, naming the account and page. Then verify with `read_page`:
1. **Professor** on a class page: the header shows "Copy invite link", and the class form has "Class size limit". Setting a limit of 1 on a test class shows "N of 1 students".
2. **Signed out**, open the copied `/join/<code>` link: it lands on sign-in. After a student signs in, it opens the class, or says "That class is full…" when the limit is reached.
3. **Any account** in General: the class spaces do not appear in Your spaces, and General still works as before.

- [ ] **Step 4: Push**

The controller pushes after the final review: `git push origin main`.
