# One workplace, phase 1: admission-gated access — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nobody can do anything in Collabify until someone admits them. The admin admits faculty and decides who can teach. Faculty admit students through class codes. Students can never create a space, and never join a work space or a work-space project by code.

**Architecture:** One new idempotent SQL file, `supabase/access.sql`, runs last. It enforces every rule in the database: a `can_teach` column, three helpers (`is_faculty`, `is_student`, `is_teaching_faculty`), `BEFORE INSERT` triggers on the General tables, and supersets of the signup, guard, approval and join functions. The frontend then shows only what the database allows. The two workplaces still exist after this phase; phase 3 merges them.

**Tech stack:** Postgres/Supabase (SQL suites run with `node scripts/db.mjs`), React 19 + TypeScript + Vite, Vitest (node environment, pure functions only).

**Spec:** `docs/superpowers/specs/2026-09-26-one-workplace-design.md`, sections 1 and 4.

## Global constraints

- The `user_role` enum value stays `'professor'` in this phase. Every screen says **Faculty**. Renaming the value itself is phase 4 (see the spec amendment in Task 3).
- `role`, `status` and `can_teach` are changeable only by an admin. `guard_privileged_columns` pins them back for everybody else, and `guard_profile_insert` forces `can_teach = false` on self-insert.
- Every gate lives in SQL. Hiding a button is never the only barrier.
- `supabase/*.sql` files stay idempotent. They get re-run.
- Never print or read `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` or `.env.local`.
- Do not stage `desktop.ini`, `docs/redesign/`, `.superpowers/`, the `*.patch` files, `graphify-out` or `verify-before-main.md`.
- Copy rules (CLAUDE.md): sentence case, active voice, no exclamation marks, no "please", no "successfully". Errors say what happened and what to do next.
- Colours come from tokens only (`text-ink`, `text-muted`, `text-faint`, `navy-*`, `amber-*`, `surface*`, `border-line*`). No raw hex.
- `npm run build` must pass before a task is called done. It runs `tsc -b` first.
- `$SCRATCH` means the session scratchpad directory. One-off scripts and snapshots go there, never into the repo.
- Commit messages: repo style (sentence-case summary line), passed through a heredoc (`git commit -F - <<'MSG'`) so backticks are never executed. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Files

```
supabase/access.sql                            NEW  every rule in this phase
supabase/tests/access.test.sql                 NEW  every gate, refused and allowed
supabase/tests/workplaces.test.sql             DELETE (enter_education and role-less signup are gone; what survives moves to access.test.sql)
supabase/tests/general*.test.sql, presets.test.sql   fixtures register approved faculty instead of role-less accounts
supabase/tests/approvals.test.sql, audit.test.sql    decide_professor → decide_faculty
scripts/schema-drift.mjs, docs/07-backup.md          register access.sql
docs/superpowers/specs/2026-09-26-one-workplace-design.md   amendments
src/lib/access.ts + access.test.ts             NEW  isFaculty, canTeach
src/lib/api/access.ts                          NEW  amIAdmitted
src/hooks/useAdmission.ts                      NEW
src/lib/types.ts                               Profile.can_teach, ProfessorAccount.can_teach, AuditAction teaching_changed
src/lib/api/admin.ts                           decideFaculty, setFacultyTeaching
src/pages/app/admin/AuditLog.tsx               teaching_changed icon/tone
src/lib/workplace.ts + workplace.test.ts       pending and role-less land on /pending
src/routes/ProtectedRoute.tsx                  General needs an admitted account too
src/pages/auth/{Register,Onboarding,Pending}.tsx
src/pages/auth/EnterEducation.tsx              DELETE
src/components/auth/WorkplaceChoice.tsx        DELETE
src/components/ui/RoleChoice.tsx               Faculty
src/context/AuthContext.tsx                    no workplace on signup, no enterEducation
src/App.tsx                                    drop /education/enter
src/components/app/nav.ts + nav.test.ts        narrow rail for a student in nothing; "Faculty approvals"
src/components/app/SideNav.tsx                 passes admission
src/components/classes/JoinClassDialog.tsx     NEW  extracted from StudentClasses
src/pages/app/classes/StudentClasses.tsx, src/pages/app/StudentHome.tsx
src/pages/app/admin/ProfessorApprovals.tsx     Can teach at approval, toggle afterwards
src/pages/app/classes/ProfessorClasses.tsx     Create class only when teaching
src/pages/general/{GeneralHome,SpacePicker,GeneralProjects}.tsx   create/join only for faculty
```

---

### Task 1: Account-level access in SQL

**Files:**
- Create: `supabase/access.sql`
- Create: `supabase/tests/access.test.sql`

**Interfaces:**
- Produces (SQL): column `profiles.can_teach boolean not null default false`; audit action `'teaching_changed'`; functions `is_faculty(uuid) → boolean`, `is_student(uuid) → boolean`, `is_teaching_faculty(uuid) → boolean`, `am_i_admitted() → boolean`, `decide_faculty(p_user uuid, p_approve boolean, p_can_teach boolean default null) → profiles`, `set_faculty_teaching(p_user uuid, p_can_teach boolean) → profiles`; view `professor_accounts` gains a trailing `can_teach` column.
- Removes: `decide_professor(uuid, boolean)`, `enter_education(user_role)`.

- [ ] **Step 1: Snapshot the account columns this task changes**

Run:
```bash
node scripts/db.mjs -c "select id, role, status from public.profiles order by created_at" > "$SCRATCH/profiles-before-access.txt"; wc -l "$SCRATCH/profiles-before-access.txt"
```
Expected: about 30 lines (24 accounts plus table borders). The migration only adds a column and turns `can_teach` on for existing professors, so this snapshot is enough to check nothing else moved.

- [ ] **Step 2: Write the failing test**

Create `supabase/tests/access.test.sql`:

```sql
-- Admission-gated access — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/access.test.sql
--
-- Nobody does anything until somebody admits them: the admin admits faculty
-- and says whether they teach, faculty admit students with a class code.
-- Every refusal is paired with somebody who is allowed the same thing.

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
  v_student  uuid := gen_random_uuid();
  v_student2 uuid := gen_random_uuid();
  v_student3 uuid := gen_random_uuid();  -- joins a class, and nothing else
  v_teacher  uuid := gen_random_uuid();  -- approved, teaches
  v_staff    uuid := gen_random_uuid();  -- approved, does not teach
  v_pending  uuid := gen_random_uuid();  -- faculty waiting on the admin
  v_legacy   uuid := gen_random_uuid();  -- an old client still sending workplace = general
  v_bare     uuid := gen_random_uuid();  -- Google, no profile yet
  v_bare2    uuid := gen_random_uuid();
  v_admin    uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_user_meta_data, created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', v.meta, now(), now()
    from (values
      (v_student,  'zz-acc-student@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Student', 'role', 'student')),
      (v_student2, 'zz-acc-student2@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Studenttwo', 'role', 'student')),
      (v_student3, 'zz-acc-student3@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Studentthree', 'role', 'student')),
      (v_teacher,  'zz-acc-teacher@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Teacher', 'role', 'professor')),
      (v_staff,    'zz-acc-staff@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Staff', 'role', 'professor')),
      (v_pending,  'zz-acc-pending@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Pending', 'role', 'professor')),
      (v_legacy,   'zz-acc-legacy@example.test',
       jsonb_build_object('first_name', 'Zz', 'last_name', 'Legacy', 'workplace', 'general')),
      (v_bare,     'zz-acc-bare@example.test',  '{}'::jsonb),
      (v_bare2,    'zz-acc-bare2@example.test', '{}'::jsonb)
    ) as v(id, em, meta);

  select id into v_admin from public.profiles
   where role = 'admin' and status = 'active' order by created_at limit 1;
  if v_admin is null then
    raise exception 'This suite needs an active admin account in the database';
  end if;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('student', v_student), ('student2', v_student2), ('student3', v_student3),
    ('teacher', v_teacher), ('staff', v_staff), ('pending', v_pending),
    ('legacy', v_legacy), ('bare', v_bare), ('bare2', v_bare2), ('admin', v_admin);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ signup

do $$
declare
  v_student uuid := (select v from fx where k = 'student');
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_legacy  uuid := (select v from fx where k = 'legacy');
  v_bare    uuid := (select v from fx where k = 'bare');
begin
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a student signup is active and does not teach',
    (select status = 'active' and not can_teach from public.profiles where id = v_student));
  perform pg_temp.must_be('a faculty signup waits for the admin and does not teach',
    (select status = 'pending' and not can_teach from public.profiles where id = v_teacher));
  perform pg_temp.must_be('a signup naming only a workplace gets no profile until onboarding',
    not exists (select 1 from public.profiles where id = v_legacy));
  perform pg_temp.must_be('a Google account gets no profile until onboarding',
    not exists (select 1 from public.profiles where id = v_bare));
end $$;

-- ------------------------------------------------------------------ onboarding

do $$
declare
  v_bare  uuid := (select v from fx where k = 'bare');
  v_bare2 uuid := (select v from fx where k = 'bare2');
begin
  perform pg_temp.act_as(v_bare);
  perform pg_temp.must_refuse('onboarding cannot make you an admin', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status)
       values (%L, 'zz-acc-bare@example.test', 'Zz', 'Bare', 'admin', 'active')$q$, v_bare));
  perform pg_temp.must_refuse('onboarding cannot skip choosing student or faculty', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status)
       values (%L, 'zz-acc-bare@example.test', 'Zz', 'Bare', null, 'active')$q$, v_bare));

  perform pg_temp.act_as(v_bare2);
  perform pg_temp.must_allow('onboarding as faculty is allowed', format(
    $q$insert into public.profiles (id, email, first_name, last_name, role, status, can_teach)
       values (%L, 'zz-acc-bare2@example.test', 'Zz', 'Baretwo', 'professor', 'active', true)$q$,
    v_bare2));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...but it waits for approval and does not teach, whatever was sent',
    (select status = 'pending' and not can_teach from public.profiles where id = v_bare2));
end $$;

-- ------------------------------------------------------------------ privileged columns

do $$
declare
  v_student uuid := (select v from fx where k = 'student');
begin
  perform pg_temp.act_as(v_student);
  update public.profiles set role = 'professor', status = 'active', can_teach = true
   where id = v_student;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an account cannot write its own role, status or teaching',
    (select role = 'student' and status = 'active' and not can_teach
       from public.profiles where id = v_student));

  perform pg_temp.must_be('enter_education is gone',
    not exists (select 1 from pg_proc where proname = 'enter_education'));
  perform pg_temp.must_be('decide_professor is gone',
    not exists (select 1 from pg_proc where proname = 'decide_professor'));
end $$;

-- ------------------------------------------------------------------ admission by the admin

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_staff   uuid := (select v from fx where k = 'staff');
  v_student uuid := (select v from fx where k = 'student');
  v_admin   uuid := (select v from fx where k = 'admin');
begin
  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_refuse('faculty cannot approve themselves',
    format('select public.decide_faculty(%L, true, true)', v_staff));

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the admin approves a teacher',
    format('select public.decide_faculty(%L, true, true)', v_teacher));
  perform pg_temp.must_allow('the admin approves staff who do not teach',
    format('select public.decide_faculty(%L, true, false)', v_staff));
  perform pg_temp.must_refuse('a student does not go through faculty approval',
    format('select public.decide_faculty(%L, true, true)', v_student));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the teacher is active and teaches',
    (select status = 'active' and can_teach from public.profiles where id = v_teacher));
  perform pg_temp.must_be('the staff member is active and does not teach',
    (select status = 'active' and not can_teach from public.profiles where id = v_staff));

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_refuse('faculty cannot change who teaches',
    format('select public.set_faculty_teaching(%L, true)', v_staff));

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the admin turns teaching on later',
    format('select public.set_faculty_teaching(%L, true)', v_staff));
  perform pg_temp.must_allow('...and off again',
    format('select public.set_faculty_teaching(%L, false)', v_staff));
  perform pg_temp.must_refuse('teaching is only for faculty accounts',
    format('select public.set_faculty_teaching(%L, true)', v_student));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('each teaching change is in the audit log',
    (select count(*) = 2 from public.audit_events
      where action = 'teaching_changed' and subject_id = v_staff));
end $$;

-- ------------------------------------------------------------------ who is admitted

do $$
declare
  v_student uuid := (select v from fx where k = 'student');
  v_staff   uuid := (select v from fx where k = 'staff');
  v_pending uuid := (select v from fx where k = 'pending');
begin
  perform pg_temp.act_as(v_student);
  perform pg_temp.must_be('a student in nothing is not admitted', not public.am_i_admitted());

  perform pg_temp.act_as(v_pending);
  perform pg_temp.must_be('pending faculty are not admitted', not public.am_i_admitted());
  perform pg_temp.must_be('...and cannot read General', not public.general_viewer_active());

  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_be('approved faculty are admitted', public.am_i_admitted());
  perform pg_temp.must_be('...and can read General', public.general_viewer_active());
end $$;

rollback;
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `node scripts/db.mjs supabase/tests/access.test.sql`
Expected: `fixture ready`, then an error on the first `must_be`: `column "can_teach" does not exist`.

- [ ] **Step 4: Write `supabase/access.sql` (account level)**

```sql
-- Collabify — admission-gated access. One workplace, phase 1.
--
--   node scripts/db.mjs supabase/access.sql
--
-- Nobody does anything until somebody admits them. The admin admits faculty
-- and says whether each one teaches. Faculty admit students, through a class
-- code or an invitation. A student can never make a space, and never walks into
-- a work space or a work-space project on a code.
--
-- The enum value is still 'professor'; the product calls it Faculty. The value
-- itself is renamed in phase 4, once the code that spells it has settled.
--
-- Runs last. Redefines, as supersets: handle_new_user (consent.sql,
-- workplaces.sql), guard_privileged_columns and guard_profile_insert
-- (workplaces.sql), log_profile_change (audit.sql), general_viewer_active and
-- join_general_project (general.sql), join_general_space (general-spaces.sql),
-- the professor_accounts view (admin-rename.sql) and the classes_insert policy
-- (classes.sql). Re-run this file after re-running any of those.
--
-- Idempotent. Safe to re-run.

-- A new enum value cannot be used in the transaction that adds it, and the
-- audit trigger below uses it. So it commits on its own first.
begin;

do $$
begin
  alter type public.audit_action add value if not exists 'teaching_changed';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- can_teach

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'can_teach'
  ) then
    alter table public.profiles add column can_teach boolean not null default false;
    -- Everybody who could run a class yesterday still can. Done only when the
    -- column is new, so a re-run never turns back on what the admin turned off.
    update public.profiles set can_teach = true where role = 'professor';
  end if;
end $$;

comment on column public.profiles.can_teach is
  'Set by the admin. Faculty with this on can open classes; without it, only work spaces.';

-- ---------------------------------------------------------------- helpers

/** Admitted faculty, and the admin. Pending and deactivated accounts are neither. */
create or replace function public.is_faculty(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = p_user and role in ('professor', 'admin') and status = 'active'
  );
$$;

create or replace function public.is_student(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and role = 'student');
$$;

/** Faculty the admin has let open classes. */
create or replace function public.is_teaching_faculty(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = p_user and role in ('professor', 'admin') and status = 'active' and can_teach
  );
$$;

/**
 * Whether the caller has been let in by anybody.
 *
 * Faculty are let in by the admin's approval. A student is let in by the first
 * class, space or project that takes them. No argument on purpose: nobody
 * needs to ask this about somebody else.
 */
create or replace function public.am_i_admitted()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.status = 'active'
       and (
         p.role in ('professor', 'admin')
         or exists (select 1 from public.class_members m
                     where m.student_id = p.id and m.status = 'active')
         or exists (select 1 from public.general_space_members s where s.user_id = p.id)
         or exists (select 1 from public.general_members g where g.user_id = p.id)
       )
  );
$$;

grant execute on function public.am_i_admitted() to authenticated;

/**
 * General's read gate. It used to let a pending professor in, because General
 * needed no approval. Now nothing opens before approval, so an account waiting
 * on the admin reads nothing here either.
 */
create or replace function public.general_viewer_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and status = 'active' and role is not null
  );
$$;

-- ---------------------------------------------------------------- privilege guards

/**
 * Role, status and teaching are the admin's to set. The one exception this
 * used to carry — `enter_education` letting a role-less account pick a role
 * once — is gone with that function.
 */
create or replace function public.guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;
  if (new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.can_teach is distinct from old.can_teach)
     and not public.is_admin() then
    -- Pinned back rather than raised: a client that tries this is not owed an
    -- error message describing the rule it just failed to break.
    new.role := old.role;
    new.status := old.status;
    new.can_teach := old.can_teach;
  end if;
  return new;
end;
$$;

/**
 * Onboarding writes the profile row itself, and `profiles_insert_own` checks
 * nothing but the id. Every account now has to be a student or faculty from the
 * first row, and teaching is only ever granted by the admin.
 */
create or replace function public.guard_profile_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.id is distinct from auth.uid() then
    raise exception 'You can only create your own profile'
      using errcode = 'insufficient_privilege';
  end if;
  if new.role is null or new.role not in ('student', 'professor') then
    raise exception 'Choose student or faculty to finish your profile'
      using errcode = 'check_violation';
  end if;
  new.status := case when new.role = 'professor' then 'pending' else 'active' end
                ::public.account_status;
  new.can_teach := false;
  return new;
end;
$$;

-- ---------------------------------------------------------------- signup

/**
 * The General branch is gone: registration asks for student or faculty and
 * nothing else. An account whose metadata names no role — Google, or an old
 * client still sending a workplace — gets no profile here and finishes on the
 * onboarding screen, which asks for a role.
 */
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_role text := nullif(new.raw_user_meta_data ->> 'role', '');
  resolved_role public.user_role;
  doc text;
  ver text;
begin
  -- Consent first, and outside the role check: see consent.sql.
  foreach doc in array array['privacy', 'terms'] loop
    ver := nullif(new.raw_user_meta_data ->> ('consent_' || doc), '');
    if ver is not null then
      if not exists (
        select 1 from public.legal_versions
         where document = doc and version = ver
      ) then
        raise exception
          'Consent to unpublished % version %. Add it to legal_versions in supabase/consent.sql.',
          doc, ver
          using errcode = 'foreign_key_violation';
      end if;

      insert into public.consent_records (user_id, document, version, surface)
      values (new.id, doc, ver, 'register')
      on conflict (user_id, document, version) do nothing;
    end if;
  end loop;

  if meta_role is null or meta_role not in ('student', 'professor') then
    return new;
  end if;

  resolved_role := meta_role::public.user_role;

  insert into public.profiles
    (id, email, first_name, middle_name, last_name, role, status, avatar_url, home_workplace)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'middle_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    resolved_role,
    case when resolved_role = 'professor' then 'pending' else 'active' end::public.account_status,
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    'education'
  )
  on conflict (id) do nothing;

  insert into public.notification_prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop function if exists public.enter_education(public.user_role);

-- ---------------------------------------------------------------- audit

/** audit.sql's trigger, plus the teaching switch. */
create or replace function public.log_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, after_value)
    values ('account_created', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            coalesce(new.role::text, 'none') || ' · ' || new.status::text);
    return new;
  end if;

  if new.role is distinct from old.role then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, before_value, after_value)
    values ('role_changed', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            coalesce(old.role::text, 'none'), coalesce(new.role::text, 'none'));
  end if;

  if new.status is distinct from old.status then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, before_value, after_value)
    values ('status_changed', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            old.status::text, new.status::text);
  end if;

  if new.can_teach is distinct from old.can_teach then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, before_value, after_value)
    values ('teaching_changed', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            case when old.can_teach then 'teaching' else 'not teaching' end,
            case when new.can_teach then 'teaching' else 'not teaching' end);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------- approval

drop function if exists public.decide_professor(uuid, boolean);

/**
 * Approve or turn down a faculty account, and optionally say whether it
 * teaches. `p_can_teach` null leaves teaching as it was, which is what a
 * turn-down or a second approval wants.
 */
create or replace function public.decide_faculty(
  p_user      uuid,
  p_approve   boolean,
  p_can_teach boolean default null
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only the program admin approves faculty accounts'
      using errcode = 'insufficient_privilege';
  end if;

  select * into target from public.profiles where id = p_user for update;
  if target.id is null then
    raise exception 'That account no longer exists';
  end if;
  if target.role is distinct from 'professor' then
    raise exception 'Only faculty accounts go through approval'
      using errcode = 'check_violation';
  end if;

  update public.profiles
     set status     = case when p_approve then 'active' else 'rejected' end::public.account_status,
         can_teach  = coalesce(p_can_teach, can_teach),
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_user
  returning * into target;

  return target;
end;
$$;

grant execute on function public.decide_faculty(uuid, boolean, boolean) to authenticated;

/** Turn teaching on or off for a faculty account after approval. */
create or replace function public.set_faculty_teaching(p_user uuid, p_can_teach boolean)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only the program admin decides who teaches'
      using errcode = 'insufficient_privilege';
  end if;

  select * into target from public.profiles where id = p_user for update;
  if target.id is null then
    raise exception 'That account no longer exists';
  end if;
  if target.role is distinct from 'professor' then
    raise exception 'Only faculty accounts can teach'
      using errcode = 'check_violation';
  end if;

  update public.profiles set can_teach = p_can_teach where id = p_user
  returning * into target;
  return target;
end;
$$;

grant execute on function public.set_faculty_teaching(uuid, boolean) to authenticated;

/** admin-rename.sql's view, with teaching on the end. Columns only ever append. */
create or replace view public.professor_accounts
with (security_invoker = true) as
select p.id,
       p.first_name,
       p.middle_name,
       p.last_name,
       p.email,
       p.avatar_url,
       p.status,
       p.created_at,
       p.decided_at,
       p.decided_by,
       btrim(d.first_name || ' ' || d.last_name) as decided_by_name,
       (select count(*) from public.classes c where c.professor_id = p.id)::int as class_count,
       p.can_teach
  from public.profiles p
  left join public.profiles d on d.id = p.decided_by
 where p.role = 'professor';

commit;
```

- [ ] **Step 5: Apply it and run the test**

Run: `node scripts/db.mjs supabase/access.sql && node scripts/db.mjs supabase/tests/access.test.sql`
Expected: every line reads `PASS`, no `FAIL`, and the run ends `Done.`

- [ ] **Step 6: Re-run the migration to prove it is idempotent**

Run: `node scripts/db.mjs supabase/access.sql && node scripts/db.mjs -c "select role, can_teach, count(*) from public.profiles group by 1, 2 order by 1"`
Expected: no error. Professors show `can_teach = true`; students and the admin show `false`.

- [ ] **Step 7: Commit**

```bash
git add supabase/access.sql supabase/tests/access.test.sql
git commit -F - <<'MSG'
Gate accounts on admission: teaching flag, faculty approval, no self-chosen role

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 2: Creation and joining gates in SQL

**Files:**
- Modify: `supabase/access.sql` (append a second `begin; … commit;` block after the first)
- Modify: `supabase/tests/access.test.sql` (insert the new sections before the final `rollback;`)

**Interfaces:**
- Consumes: `is_faculty(uuid)`, `is_student(uuid)`, `is_teaching_faculty(uuid)` from Task 1.
- Produces (SQL): trigger functions `guard_general_creator()`, `guard_student_level()`, `guard_student_invite()` and their six triggers; supersets of `join_general_space(text)` and `join_general_project(text)`; the `classes_insert` policy requires teaching.

- [ ] **Step 1: Write the failing tests**

Insert into `supabase/tests/access.test.sql`, directly above the final `rollback;`:

```sql
-- ------------------------------------------------------------------ creating spaces and projects

do $$
declare
  v_student uuid := (select v from fx where k = 'student');
  v_pending uuid := (select v from fx where k = 'pending');
  v_staff   uuid := (select v from fx where k = 'staff');
  v_space   uuid;
begin
  perform pg_temp.act_as(v_student);
  perform pg_temp.must_refuse('a student cannot create a space',
    $q$select public.create_general_space('Zz student space', '')$q$);
  perform pg_temp.must_refuse('a student cannot create a project',
    $q$select public.create_general_project('Zz student project')$q$);

  perform pg_temp.act_as(v_pending);
  perform pg_temp.must_refuse('pending faculty cannot create a space',
    $q$select public.create_general_space('Zz pending space', '')$q$);

  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_allow('approved faculty create a space, teaching or not',
    $q$select public.create_general_space('Zz office', '')$q$);

  perform pg_temp.act_as_service();
  select id into v_space from public.general_spaces where name = 'Zz office' and created_by = v_staff;
  insert into fx values ('space', v_space);

  perform pg_temp.act_as(v_staff);
  insert into fx
  select 'project', (public.create_general_project('Zz office project', '', null, null, null, null, v_space)).id;
end $$;

-- ------------------------------------------------------------------ joining by code

do $$
declare
  v_student uuid := (select v from fx where k = 'student');
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_staff   uuid := (select v from fx where k = 'staff');
  v_space   uuid := (select v from fx where k = 'space');
  v_project uuid := (select v from fx where k = 'project');
  v_space_code   text;
  v_project_code text;
begin
  perform pg_temp.act_as(v_staff);
  v_space_code := public.set_general_space_join_code(v_space, true, true);
  v_project_code := public.set_general_join_code(v_project, true, true);

  perform pg_temp.act_as(v_student);
  perform pg_temp.must_refuse('a student cannot join a work space by code',
    format('select public.join_general_space(%L)', v_space_code));
  perform pg_temp.must_refuse('a student cannot join a work-space project by code',
    format('select public.join_general_project(%L)', v_project_code));

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_allow('faculty join a work space by code',
    format('select public.join_general_space(%L)', v_space_code));
  perform pg_temp.must_allow('...and a project by code',
    format('select public.join_general_project(%L)', v_project_code));
end $$;

-- ------------------------------------------------------------------ invitations and levels

do $$
declare
  v_student  uuid := (select v from fx where k = 'student');
  v_student2 uuid := (select v from fx where k = 'student2');
  v_staff    uuid := (select v from fx where k = 'staff');
  v_space    uuid := (select v from fx where k = 'space');
  v_project  uuid := (select v from fx where k = 'project');
  v_inv      uuid;
begin
  perform pg_temp.act_as(v_staff);
  v_inv := (public.invite_to_general_space(v_space, v_student)).id;
  perform pg_temp.act_as(v_student);
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('faculty invite a student into a work space, as a member',
    (select level = 'member' from public.general_space_members
      where space_id = v_space and user_id = v_student));

  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_refuse('a student cannot be made a Manager of a space',
    format('select public.set_general_space_level(%L, %L, %L)', v_space, v_student, 'manager'));

  perform pg_temp.act_as(v_student);
  perform pg_temp.must_refuse('a student cannot invite another student into a space',
    format('select public.invite_to_general_space(%L, %L)', v_space, v_student2));

  perform pg_temp.act_as(v_staff);
  v_inv := (public.invite_to_general_project(v_project, v_student2)).id;
  perform pg_temp.act_as(v_student2);
  perform public.respond_general_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('faculty invite a student onto a project, as a member',
    (select level = 'member' from public.general_members
      where project_id = v_project and user_id = v_student2));

  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_refuse('a student cannot be made a Manager of a project',
    format('select public.set_general_member_level(%L, %L, %L)', v_project, v_student2, 'manager'));
end $$;

-- ------------------------------------------------------------------ classes

do $$
declare
  v_teacher  uuid := (select v from fx where k = 'teacher');
  v_staff    uuid := (select v from fx where k = 'staff');
  v_student3 uuid := (select v from fx where k = 'student3');
  v_result   text;
begin
  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_refuse('faculty who do not teach cannot open a class', format(
    $q$insert into public.classes
         (professor_id, name, initial, code, section, year_level, semester, school_year)
       values (%L, 'Zz Staff class', 'ZZS', 'ZZACC-STAFF', 'BSIT 1A', '1st', '1st', '2026-2027')$q$,
    v_staff));

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_allow('teaching faculty open a class', format(
    $q$insert into public.classes
         (professor_id, name, initial, code, section, year_level, semester, school_year)
       values (%L, 'Zz Teacher class', 'ZZT', 'ZZACC-TEACH', 'BSIT 1A', '1st', '1st', '2026-2027')$q$,
    v_teacher));

  perform pg_temp.act_as(v_student3);
  perform pg_temp.must_be('a student in nothing is not admitted yet', not public.am_i_admitted());
  select public.join_class('ZZACC-TEACH') ->> 'result' into v_result;
  perform pg_temp.must_be('a student joins a class with its code', v_result = 'joined');
  perform pg_temp.must_be('...and is admitted from then on', public.am_i_admitted());
end $$;
```

- [ ] **Step 2: Run to confirm the new sections fail**

Run: `node scripts/db.mjs supabase/tests/access.test.sql`
Expected: the Task 1 sections pass, then `FAIL  a student cannot create a space — it went through and should not have`.

- [ ] **Step 3: Append the gates to `supabase/access.sql`**

Add after the final `commit;` of the file:

```sql
begin;

-- ---------------------------------------------------------------- who may create

/**
 * Spaces and projects are opened by faculty. A student's work lives in the
 * classes and spaces somebody let them into.
 *
 * A trigger rather than a check in each function: `create_general_space`,
 * `create_general_project` and every restore or duplicate path that inserts a
 * row all pass through here, including ones written after this file.
 */
create or replace function public.guard_general_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_faculty(auth.uid()) then
    raise exception '%', case tg_table_name
        when 'general_spaces' then 'Only faculty can create a space. Ask a faculty member to invite you to one.'
        else 'Only faculty can create a project. Ask a faculty member to invite you to one.'
      end
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists general_spaces_creator on public.general_spaces;
create trigger general_spaces_creator before insert on public.general_spaces
  for each row execute function public.guard_general_creator();

drop trigger if exists general_projects_creator on public.general_projects;
create trigger general_projects_creator before insert on public.general_projects
  for each row execute function public.guard_general_creator();

-- ---------------------------------------------------------------- student levels

/** Owner and Manager are faculty levels. A student is always a member. */
create or replace function public.guard_student_level()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.level <> 'member' and public.is_student(new.user_id) then
    raise exception 'A student can only be a member. Owner and Manager are for faculty.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists general_space_members_student_level on public.general_space_members;
create trigger general_space_members_student_level
  before insert or update of level on public.general_space_members
  for each row execute function public.guard_student_level();

drop trigger if exists general_members_student_level on public.general_members;
create trigger general_members_student_level
  before insert or update of level on public.general_members
  for each row execute function public.guard_student_level();

-- ---------------------------------------------------------------- inviting students

/** A student comes into a work space only because a faculty member asked them. */
create or replace function public.guard_student_invite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and public.is_student(new.invitee)
     and not public.is_faculty(auth.uid()) then
    raise exception 'Only faculty can invite a student.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists general_space_invitations_student on public.general_space_invitations;
create trigger general_space_invitations_student before insert on public.general_space_invitations
  for each row execute function public.guard_student_invite();

drop trigger if exists general_invitations_student on public.general_invitations;
create trigger general_invitations_student before insert on public.general_invitations
  for each row execute function public.guard_student_invite();

-- ---------------------------------------------------------------- joining by code

/** general-spaces.sql's version, refusing students before a guess is counted. */
create or replace function public.join_general_space(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  s public.general_spaces%rowtype;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to join a space'
      using errcode = 'insufficient_privilege';
  end if;
  if public.is_student(auth.uid()) then
    raise exception 'Students join classes with a class code. A faculty member can invite you to a space.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Counted before the code is read, so a wrong guess costs an attempt.
  perform public.rate_limit('general_space_join', 10, interval '10 minutes',
    'Too many join attempts. Wait a few minutes and try again.');

  select sp.* into s
    from public.general_space_join_codes jc
    join public.general_spaces sp on sp.id = jc.space_id
   where jc.code = upper(btrim(p_code)) and jc.open and sp.archived_at is null;
  if s.id is null then
    return null; -- a miss, not a refusal; the rate-limit count already committed
  end if;

  insert into public.general_space_members (space_id, user_id)
  values (s.id, auth.uid())
  on conflict do nothing;

  update public.general_space_invitations
     set status = 'accepted', answered_at = now()
   where space_id = s.id and invitee = auth.uid() and status = 'pending';

  return s.id;
end;
$$;

/** general.sql's version, refusing students before a guess is counted. */
create or replace function public.join_general_project(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p public.general_projects%rowtype;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to join a project'
      using errcode = 'insufficient_privilege';
  end if;
  if public.is_student(auth.uid()) then
    raise exception 'Students join classes with a class code. A faculty member can invite you to a project.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Counted before the code is read, so a wrong guess costs an attempt.
  perform public.rate_limit('general_join', 10, interval '10 minutes',
    'Too many join attempts. Wait a few minutes and try again.');

  select pr.* into p
    from public.general_join_codes jc
    join public.general_projects pr on pr.id = jc.project_id
   where jc.code = upper(btrim(p_code)) and jc.open and pr.archived_at is null;
  if p.id is null then
    return null; -- a miss, not a refusal; the rate-limit count already committed
  end if;

  insert into public.general_members (project_id, user_id)
  values (p.id, auth.uid())
  on conflict do nothing;

  update public.general_invitations
     set status = 'accepted', answered_at = now()
   where project_id = p.id and invitee = auth.uid() and status = 'pending';

  return p.id;
end;
$$;

-- ---------------------------------------------------------------- opening a class

/** classes.sql's policy, plus teaching: approval alone no longer opens classes. */
drop policy if exists classes_insert on public.classes;
create policy classes_insert on public.classes
  for insert with check (
    professor_id = auth.uid() and public.is_teaching_faculty(auth.uid())
  );

commit;
```

- [ ] **Step 4: Apply and run**

Run: `node scripts/db.mjs supabase/access.sql && node scripts/db.mjs supabase/tests/access.test.sql`
Expected: every line `PASS`, no `FAIL`.

If `a student joins a class with its code` reports something other than `joined`, print it with `raise notice 'join_class said %', v_result;` and read `join_class` in `supabase/rate-limit.sql` for the refusal it returned. Do not loosen the assertion.

- [ ] **Step 5: Commit**

```bash
git add supabase/access.sql supabase/tests/access.test.sql
git commit -F - <<'MSG'
Only faculty create spaces and projects; students come in by invitation or class code

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 3: Bring the existing SQL suites, drift check and docs in line

**Files:**
- Modify: the 15 files matching `grep -l "'workplace', 'general'" supabase/tests/*.sql`, except `workplaces.test.sql`
- Modify: `supabase/tests/approvals.test.sql`, `supabase/tests/audit.test.sql`
- Delete: `supabase/tests/workplaces.test.sql`
- Modify: `scripts/schema-drift.mjs:32`, `docs/07-backup.md`
- Modify: `docs/superpowers/specs/2026-09-26-one-workplace-design.md`

**Interfaces:**
- Consumes: `decide_faculty(uuid, boolean, boolean default null)` from Task 1.

- [ ] **Step 1: See which suites fail now**

Run:
```bash
for f in supabase/tests/*.test.sql; do out=$(node scripts/db.mjs "$f" 2>&1); if echo "$out" | grep -qE "FAIL|error:|ERROR"; then echo "✗ $f: $(echo "$out" | grep -m1 -E "FAIL|error:|ERROR")"; else echo "✓ $f ($(echo "$out" | grep -c PASS) pass)"; fi; done
```
Expected: `access.test.sql` passes. The General suites, `presets`, `approvals`, `audit` and `workplaces` fail. Their fixtures register role-less General accounts, which `general_viewer_active` and the creation gate now refuse, and they call `decide_professor`.

- [ ] **Step 2: Move General fixtures to approved faculty**

Write the one-off script to the scratchpad (it is not committed) and run it:

```js
// fixtures.mjs — General test accounts become approved faculty (access.sql).
import { readFileSync, writeFileSync } from 'node:fs'

for (const file of process.argv.slice(2)) {
  let sql = readFileSync(file, 'utf8')
  const nl = sql.includes('\r\n') ? '\r\n' : '\n'
  const activate =
    `${nl}  -- General accounts are approved faculty now: supabase/access.sql.` +
    `${nl}  update public.profiles set status = 'active'` +
    ` where created_at = now() and role = 'professor' and status = 'pending';`
  sql = sql.replaceAll("'workplace', 'general'", "'role', 'professor'")
  let out = ''
  let from = 0
  for (;;) {
    const at = sql.indexOf('insert into auth.users', from)
    if (at < 0) { out += sql.slice(from); break }
    const end = sql.indexOf(';', at)
    out += sql.slice(from, end + 1) + activate
    from = end + 1
  }
  writeFileSync(file, out)
  console.log('updated', file)
}
```

Run:
```bash
node "$SCRATCH/fixtures.mjs" $(grep -l "'workplace', 'general'" supabase/tests/*.sql | grep -v workplaces.test.sql)
```
Expected: 15 `updated` lines. `created_at = now()` matches exactly the profiles made in the test's own transaction, because `now()` is the transaction's start time.

- [ ] **Step 3: Switch approvals and audit to `decide_faculty`**

In `supabase/tests/approvals.test.sql`, replace every `public.decide_professor(%L, true)` with `public.decide_faculty(%L, true)` and every `public.decide_professor(%L, false)` with `public.decide_faculty(%L, false)`. The third argument is left out on purpose: teaching stays as it was, so these suites keep asserting exactly what they did.

In `supabase/tests/audit.test.sql:106`, replace `perform public.decide_professor(v_new, true);` with `perform public.decide_faculty(v_new, true);`.

- [ ] **Step 4: Delete `workplaces.test.sql`**

Run: `git rm supabase/tests/workplaces.test.sql`

Its surviving assertions now live in `access.test.sql`: Google accounts get no profile, onboarding can't make an admin, faculty onboarding waits for approval, and self-written role is pinned back. The rest tested `enter_education` and role-less General signup, and both are gone.

- [ ] **Step 5: Re-run every suite**

Run the loop from Step 1.
Expected: every file shows `✓`, with 37 files in total (38 − `workplaces` + `access`). If a suite still fails, read its first `FAIL` line. A failure that comes from a student or role-less fixture meeting one of the new gates means the fixture needs updating, the same way Step 2 did it. A failure anywhere else is a real regression and goes back to Tasks 1–2.

- [ ] **Step 6: Register `access.sql`**

`scripts/schema-drift.mjs:32`: append ` access` after `general-project-space` inside the ORDER template string.

`docs/07-backup.md`: append ` supabase/access.sql` to the end of the restore command on line 26. After the paragraph that ends "…without the space name the projects page reads.", add:

```markdown
`access.sql` runs last and redefines, as supersets, functions from
`workplaces.sql`, `consent.sql`, `audit.sql`, `admin-rename.sql`,
`general.sql`, `general-spaces.sql` and the `classes_insert` policy from
`classes.sql`. Re-run it after re-running any of those on its own, or the
admission gates go back to their older, open form.
```

Run: `node scripts/schema-drift.mjs | tail -3`
Expected: the summary line prints with no crash. `CHECK` lines for the redefined functions are expected: the drift check only hints, and the suites are the real proof.

- [ ] **Step 7: Amend the spec to match the plan**

In `docs/superpowers/specs/2026-09-26-one-workplace-design.md`:

- Section 1, the `user_role` bullet: replace it with "The product calls the role **Faculty** from phase 1. The enum value stays `professor` until phase 4, where it is renamed once the code that spells it (84 frontend and 21 SQL sites, most of them rewritten by phase 3) has settled. A new admin-only `profiles.can_teach …`" and keep the rest of the bullet.
- Section 1, the faculty bullet: replace "Can teach can be toggled later on the admin Faculty page" with "Can teach can be toggled later on the Faculty approvals page, which lists every faculty account and its standing".
- Section 4, phase 1: replace "Role rename" with "Faculty wording (enum rename in phase 4)". Add to phase 2: "the `/join/<code>` invite link".
- Section 4, phase 4: add "rename the `professor` enum value to `faculty`".

- [ ] **Step 8: Commit**

```bash
git add supabase/tests scripts/schema-drift.mjs docs/07-backup.md docs/superpowers/specs/2026-09-26-one-workplace-design.md
git commit -F - <<'MSG'
Point the SQL suites at approved faculty and register access.sql

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 4: Access helpers, types and admin API

**Files:**
- Create: `src/lib/access.ts`, `src/lib/access.test.ts`, `src/lib/api/access.ts`, `src/hooks/useAdmission.ts`
- Modify: `src/lib/types.ts` (Profile, ProfessorAccount, AuditAction, AUDIT_ACTIONS, auditSentence), `src/lib/api/admin.ts`, `src/pages/app/admin/AuditLog.tsx`

**Interfaces:**
- Produces: `isFaculty(p: AccessProfile): boolean`, `canTeach(p: AccessProfile): boolean`, and `type AccessProfile = Pick<Profile, 'role' | 'status' | 'can_teach'> | null | undefined` from `src/lib/access.ts`; `amIAdmitted(): Promise<boolean>` from `src/lib/api/access.ts`; `useAdmission(userId: string | undefined): boolean | null` from `src/hooks/useAdmission.ts`; `decideFaculty(userId: string, approve: boolean, canTeach?: boolean): Promise<void>` and `setFacultyTeaching(userId: string, canTeach: boolean): Promise<void>` from `src/lib/api/admin.ts`. `decideProfessor` is removed.

- [ ] **Step 1: Write the failing test** — `src/lib/access.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { canTeach, isFaculty } from './access'

const p = (
  role: 'student' | 'professor' | 'admin' | null,
  status: 'active' | 'pending' | 'rejected',
  can_teach = false,
) => ({ role, status, can_teach })

describe('isFaculty', () => {
  it('admits approved faculty and the admin', () => {
    expect(isFaculty(p('professor', 'active'))).toBe(true)
    expect(isFaculty(p('admin', 'active'))).toBe(true)
  })

  it('keeps out students, waiting faculty, deactivated accounts and nobody', () => {
    expect(isFaculty(p('student', 'active'))).toBe(false)
    expect(isFaculty(p('professor', 'pending'))).toBe(false)
    expect(isFaculty(p('professor', 'rejected'))).toBe(false)
    expect(isFaculty(p(null, 'active'))).toBe(false)
    expect(isFaculty(null)).toBe(false)
  })
})

describe('canTeach', () => {
  it('needs approval and the teaching switch both', () => {
    expect(canTeach(p('professor', 'active', true))).toBe(true)
    expect(canTeach(p('professor', 'active', false))).toBe(false)
    expect(canTeach(p('professor', 'pending', true))).toBe(false)
    expect(canTeach(p('student', 'active', true))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/access.test.ts`
Expected: FAIL, `Failed to resolve import "./access"`.

- [ ] **Step 3: Add `can_teach` to the types**

In `src/lib/types.ts`, inside `export type Profile`, after `status: AccountStatus`:

```ts
  /** Set by the admin. Faculty with this on can open classes. */
  can_teach: boolean
```

Inside `export type ProfessorAccount`, after `class_count: number`:

```ts
  /** Whether the admin lets this account open classes. */
  can_teach: boolean
```

Add `| 'teaching_changed'` as the last member of `AuditAction`. Add `{ value: 'teaching_changed', label: 'Teaching changed' },` after the `status_changed` entry in `AUDIT_ACTIONS`. Add a case to `auditSentence` after `status_changed`:

```ts
    case 'teaching_changed':
      return `${who} went from ${e.before_value} to ${e.after_value}`
```

In `src/pages/app/admin/AuditLog.tsx`, add `teaching_changed: 'shield',` to `ICON` after `status_changed`, and `teaching_changed: 'bg-navy-50 text-navy-700 dark:bg-navy-500/18 dark:text-navy-100',` to `TONE` after `status_changed`. In the `accountEvents` filter, change the array to `['account_created', 'role_changed', 'status_changed', 'teaching_changed']`.

- [ ] **Step 4: Write `src/lib/access.ts`**

```ts
/**
 * Who may do what, as the screens need to know it.
 *
 * The database decides; these only keep a screen from offering what it would
 * refuse. Each mirrors a function in supabase/access.sql of the same meaning.
 */
import type { Profile } from './types'

export type AccessProfile = Pick<Profile, 'role' | 'status' | 'can_teach'> | null | undefined

/** Approved faculty, and the admin. Mirrors `is_faculty`. */
export function isFaculty(p: AccessProfile): boolean {
  return Boolean(p && p.status === 'active' && (p.role === 'professor' || p.role === 'admin'))
}

/** Faculty the admin lets open classes. Mirrors `is_teaching_faculty`. */
export function canTeach(p: AccessProfile): boolean {
  return isFaculty(p) && Boolean(p?.can_teach)
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/lib/access.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Admission API and hook**

`src/lib/api/access.ts`:

```ts
import { supabase } from '../supabase'

/** Whether anybody has let the signed-in account in yet. See `am_i_admitted`. */
export async function amIAdmitted() {
  const { data, error } = await supabase.rpc('am_i_admitted')
  if (error) throw error
  return Boolean(data)
}
```

`src/hooks/useAdmission.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { amIAdmitted } from '../lib/api/access'
import { useLive } from './useLive'

/**
 * Null while it loads. False only for a student nobody has let in yet.
 *
 * A failed check reads as admitted: the rail is the only thing that narrows on
 * this, and hiding somebody's classes because a request dropped would be worse
 * than briefly showing an empty page they cannot use.
 */
export function useAdmission(userId: string | undefined) {
  const [admitted, setAdmitted] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    try {
      setAdmitted(await amIAdmitted())
    } catch {
      setAdmitted(true)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['class_members', 'general_space_members', 'general_members'], {
    enabled: Boolean(userId),
  })

  return admitted
}
```

Check `src/hooks/useLive.ts` for the `LiveTable` union. If any of the three table names is missing from it, add it there in the same style.

- [ ] **Step 7: Admin API**

In `src/lib/api/admin.ts`, replace the `decideProfessor` function with:

```ts
/**
 * Approve a waiting faculty account, or turn one down. Reversible either way.
 * `canTeach` is sent only on an approval; leaving it out keeps what is set.
 */
export async function decideFaculty(userId: string, approve: boolean, canTeach?: boolean) {
  const { error } = await supabase.rpc('decide_faculty', {
    p_user: userId,
    p_approve: approve,
    p_can_teach: canTeach ?? null,
  })
  if (error) throw error
}

/** Let an approved faculty account open classes, or stop it. */
export async function setFacultyTeaching(userId: string, canTeach: boolean) {
  const { error } = await supabase.rpc('set_faculty_teaching', {
    p_user: userId,
    p_can_teach: canTeach,
  })
  if (error) throw error
}
```

In `src/pages/app/admin/ProfessorApprovals.tsx`, change the import to `decideFaculty` and the call in `decide` to `await decideFaculty(account.id, approve)`, so the build stays green. Task 7 finishes that page.

- [ ] **Step 8: Build and test**

Run: `npm run build && npx vitest run`
Expected: build succeeds; every test passes, including the 3 new ones.

- [ ] **Step 9: Commit**

```bash
git add src/lib/access.ts src/lib/access.test.ts src/lib/api/access.ts src/hooks/useAdmission.ts src/hooks/useLive.ts src/lib/types.ts src/lib/api/admin.ts src/pages/app/admin/AuditLog.tsx src/pages/app/admin/ProfessorApprovals.tsx
git commit -F - <<'MSG'
Add the access helpers, admission hook and faculty approval API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 5: Sign-up, onboarding, pending and route guards

**Files:**
- Modify: `src/lib/workplace.ts`, `src/lib/workplace.test.ts`, `src/routes/ProtectedRoute.tsx`, `src/pages/auth/Pending.tsx`, `src/pages/auth/Register.tsx`, `src/pages/auth/Onboarding.tsx`, `src/components/ui/RoleChoice.tsx`, `src/context/AuthContext.tsx`, `src/App.tsx`
- Delete: `src/pages/auth/EnterEducation.tsx`, `src/components/auth/WorkplaceChoice.tsx`

**Interfaces:**
- Produces: `homeFor` and `educationHome` return `'/pending'` for any account that is not active or has no role. `SignUpInput` loses `workplace` and has `role: Exclude<Role, 'admin'>` (not nullable). `completeOnboarding` input loses `workplace`. `enterEducation` is removed from `AuthValue`.

- [ ] **Step 1: Update the failing expectations** — `src/lib/workplace.test.ts`

Replace the `homeFor` and `educationHome` describe blocks with:

```ts
describe('homeFor', () => {
  it('sends somebody with no profile to onboarding', () => {
    expect(homeFor(null)).toBe('/onboarding')
  })

  it('stops a deactivated account at the door, whichever workplace', () => {
    expect(homeFor(p('student', 'rejected', 'education'))).toBe('/pending')
    expect(homeFor(p(null, 'rejected', 'general'))).toBe('/pending')
  })

  it('parks faculty waiting on the admin, whichever workplace they last used', () => {
    expect(homeFor(p('professor', 'pending', 'general'))).toBe('/pending')
    expect(homeFor(p('professor', 'pending', 'education'))).toBe('/pending')
  })

  it('parks an old account that never got a role', () => {
    expect(homeFor(p(null, 'active', 'general'))).toBe('/pending')
    expect(homeFor(p(null, 'active', 'education'))).toBe('/pending')
  })

  it('keeps the admin on the console', () => {
    expect(homeFor(p('admin', 'active', 'education'))).toBe('/admin')
  })

  it('lands an admitted account in its home workplace', () => {
    expect(homeFor(p('student', 'active', 'education'))).toBe('/student')
    expect(homeFor(p('professor', 'active', 'general'))).toBe('/general')
  })
})

describe('educationHome', () => {
  it('parks anybody not yet admitted', () => {
    expect(educationHome(p(null, 'active', 'general'))).toBe('/pending')
    expect(educationHome(p('professor', 'pending', 'general'))).toBe('/pending')
  })

  it('opens an approved professor', () => {
    expect(educationHome(p('professor', 'active', 'general'))).toBe('/professor')
  })
})
```

In the `workplaceOf` block, delete the line `expect(workplaceOf('/education/enter', 'general')).toBe('education')`.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/workplace.test.ts`
Expected: FAIL on "parks faculty waiting on the admin" (`'/general'` received) and "parks an old account that never got a role" (`'/general'` received).

- [ ] **Step 3: Rewrite `homeFor` and `educationHome`** — `src/lib/workplace.ts`

Replace the header comment's second paragraph ("One account uses both…until it enters Education once. General needs nothing but an active account.") with:

```ts
 * One account uses both. `home_workplace` is only where sign-in lands; the
 * switcher in the top bar opens the other. Neither opens until somebody has
 * admitted the account: the admin approves faculty, and a student is let in by
 * the class they join.
```

Replace the paragraph starting "`rejected` is what the admin's Deactivate sets" with:

```ts
 * `pending` (faculty waiting on the admin), `rejected` (turned down or
 * deactivated) and an account with no role at all all land on /pending, which
 * says which of the three it is.
```

Replace the two functions with:

```ts
export function educationHome(profile: HomeProfile): string {
  if (profile.status !== 'active' || !profile.role) return '/pending'
  return EDUCATION_HOME[profile.role]
}

export function homeFor(profile: HomeProfile | null | undefined): string {
  if (!profile) return '/onboarding'
  if (profile.status !== 'active' || !profile.role) return '/pending'
  if (profile.role === 'admin') return '/admin'
  if (profile.home_workplace === 'general') return '/general'
  return EDUCATION_HOME[profile.role]
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/lib/workplace.test.ts`
Expected: PASS.

- [ ] **Step 5: Route guard** — `src/routes/ProtectedRoute.tsx`

Replace the doc comment and the body after `if (profile.status === 'rejected') …` with:

```tsx
/**
 * `workplace` says which door this is.
 *
 * - Both workplaces need an admitted account: active, with a role. Faculty
 *   waiting on the admin used to be let into General; nothing opens before
 *   approval now.
 * - No workplace (Settings, Your data) stays open to every signed-in account
 *   that is not deactivated: those are owed to everybody, admitted or not.
 */
export function ProtectedRoute({ allow, workplace }: { allow?: Role[]; workplace?: Workplace }) {
  const { ready, session, profile } = useAuth()
  const location = useLocation()

  if (!ready) return <Booting />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile) return <Navigate to="/onboarding" replace />
  if (profile.status === 'rejected') return <Navigate to="/pending" replace />
  if (!workplace) return <Outlet />

  if (profile.status !== 'active' || !profile.role) return <Navigate to="/pending" replace />
  if (workplace === 'general') return <Outlet />
  if (allow && !allow.includes(profile.role)) return <Navigate to={homeFor(profile)} replace />

  return <Outlet />
}
```

- [ ] **Step 6: Pending page** — `src/pages/auth/Pending.tsx`

Replace the component with:

```tsx
export default function Pending() {
  const { ready, session, profile, signOut, refreshProfile } = useAuth()

  if (ready && !session) return <Navigate to="/login" replace />
  if (ready && profile && profile.status === 'active' && profile.role)
    return <Navigate to={homeFor(profile)} replace />

  const rejected = profile?.status === 'rejected'
  const roleless = !rejected && profile?.status === 'active' && !profile.role

  const title = rejected ? 'Account not active' : roleless ? 'No role on this account' : 'Waiting on approval'
  const subtitle = rejected
    ? 'The program admin has not approved this account, or has deactivated it.'
    : roleless
      ? 'This account was made before registration asked for student or faculty.'
      : 'Your faculty account is with the program admin.'

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      <div className="space-y-5">
        <Alert tone={rejected ? 'error' : 'info'}>
          {rejected ? (
            <>
              Reach out to your program admin if you think this is a mistake. They can approve
              the account from the admin console.
            </>
          ) : roleless ? (
            <>Ask the program admin to set your role. This page opens your dashboard once they do.</>
          ) : (
            <>
              Check again once the program admin approves you, and this page becomes your
              dashboard. Everything stays locked until then, so the only people running a class or
              a space are faculty the school has checked.
            </>
          )}
        </Alert>

        <div className="card p-4 sm:p-5">
          <p className="eyebrow text-faint">Signed in as</p>
          <p className="mt-2 text-[14px] font-medium text-ink">{profile?.email ?? '—'}</p>
          <p className="mt-1 text-[13px] text-muted">
            Status: {rejected ? 'Not active' : roleless ? 'No role' : 'Pending review'}
          </p>
        </div>

        {!rejected && (
          <Button variant="outline" size="lg" full className="!rounded-xl" onClick={refreshProfile}>
            Check again
          </Button>
        )}
        <Button variant="ghost" size="md" full onClick={signOut}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  )
}
```

Remove the now-unused `Link` import.

- [ ] **Step 7: Role picker copy** — `src/components/ui/RoleChoice.tsx`

Replace `OPTIONS` with:

```ts
const OPTIONS: { value: Choice; label: string; note: string; icon: 'user' | 'users' }[] = [
  {
    value: 'student',
    label: 'Student',
    note: 'Join your classes with a code from your professor',
    icon: 'user',
  },
  {
    value: 'professor',
    label: 'Faculty',
    note: 'Professors and school staff · needs admin approval',
    icon: 'users',
  },
]
```

- [ ] **Step 8: Auth context** — `src/context/AuthContext.tsx`

- `SignUpInput`: delete the `workplace: Workplace` line, and replace the `role` comment and line with `role: Exclude<Role, 'admin'>`.
- `AuthValue.completeOnboarding` input: delete `workplace: Workplace` and make it `role: Exclude<Role, 'admin'>`.
- Delete `enterEducation` from `AuthValue`, delete its `useCallback` block (the one calling `supabase.rpc('enter_education', …)`), and delete `enterEducation` from both the memoised value object and its dependency array.
- In `signUpWithEmail`'s `data`, replace the two lines `role: input.workplace === 'education' ? input.role : null,` and `workplace: input.workplace,` with `role: input.role,`.
- In `completeOnboarding`, replace `const role = input.workplace === 'education' ? input.role : null` with `const role = input.role`, and replace `home_workplace: input.workplace,` with `home_workplace: 'education',`.
- Delete the `import type { Workplace } from '../lib/workplace'` line if nothing else in the file uses it.

- [ ] **Step 9: Register** — `src/pages/auth/Register.tsx`

- Delete the `WorkplaceChoice` and `Workplace` imports and the `workplace` state.
- In the `signUpWithEmail` call, delete `workplace,` and change `role: workplace === 'education' ? role : null,` to `role,`.
- Replace everything from `<WorkplaceChoice value={workplace} onChange={setWorkplace} />` through the end of its ternary (the closing `)}` after the General alert) with:

```tsx
        <RoleChoice value={role} onChange={setRole} />
        {role === 'professor' ? (
          <Alert tone="info">
            The program admin reviews faculty accounts. You can sign in straight away, and your
            tools open once you are approved.
          </Alert>
        ) : (
          <Alert tone="info">
            Your classes open once you join one with the code your professor gives you.
          </Alert>
        )}
```

- [ ] **Step 10: Onboarding** — `src/pages/auth/Onboarding.tsx`

- Delete the `WorkplaceChoice` and `Workplace` imports and the `workplace` state.
- In `completeOnboarding({...})`, delete `workplace,` and change `role: workplace === 'education' ? role : null,` to `role,`.
- Replace the `navigate(...)` call with `navigate(role === 'professor' ? '/pending' : '/student', { replace: true })`.
- Replace the `<WorkplaceChoice …/>` block and its ternary with the same `RoleChoice` and alerts as Register (Step 9).

- [ ] **Step 11: Remove the dead routes and files**

- `src/App.tsx`: delete the `const EnterEducation = lazy(() => import('./pages/auth/EnterEducation'))` line and the `<Route path="/education/enter" element={<EnterEducation />} />` line.
- Run: `git rm src/pages/auth/EnterEducation.tsx src/components/auth/WorkplaceChoice.tsx`
- Run: `grep -rn "education/enter\|WorkplaceChoice\|enterEducation\|enter_education" src`
  Expected: no output.

- [ ] **Step 12: Build and test**

Run: `npm run build && npx vitest run`
Expected: build succeeds, all tests pass.

- [ ] **Step 13: Commit**

```bash
git add -A src/lib/workplace.ts src/lib/workplace.test.ts src/routes/ProtectedRoute.tsx src/pages/auth src/components/ui/RoleChoice.tsx src/components/auth src/context/AuthContext.tsx src/App.tsx
git commit -F - <<'MSG'
Register as student or faculty, and hold everyone at the door until admitted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 6: The rail and join-a-class for a student nobody has let in

**Files:**
- Create: `src/components/app/nav.test.ts`, `src/components/classes/JoinClassDialog.tsx`
- Modify: `src/components/app/nav.ts`, `src/components/app/SideNav.tsx`, `src/pages/app/classes/StudentClasses.tsx`, `src/pages/app/StudentHome.tsx`

**Interfaces:**
- Consumes: `useAdmission(userId)` from Task 4.
- Produces: `navForWorkplace(workplace: Workplace, role: Role | null, admitted = true): NavGroup[]`; `JoinClassDialog({ open, onClose, onJoined? }: { open: boolean; onClose: () => void; onJoined?: () => void | Promise<void> })`.

- [ ] **Step 1: Write the failing test** — `src/components/app/nav.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { navForWorkplace } from './nav'
import type { NavGroup } from './nav'

const labels = (groups: NavGroup[]) => groups.flatMap((g) => g.items.map((i) => i.label))

describe('navForWorkplace', () => {
  it('gives a student nobody has let in only the dashboard and settings', () => {
    expect(labels(navForWorkplace('education', 'student', false))).toEqual(['Dashboard', 'Settings'])
  })

  it('gives an admitted student the whole rail', () => {
    expect(labels(navForWorkplace('education', 'student', true))).toContain('Classes')
    expect(labels(navForWorkplace('education', 'student'))).toContain('My tasks')
  })

  it('never narrows faculty on the admission flag', () => {
    expect(labels(navForWorkplace('education', 'professor', false))).toContain('Classes')
  })

  it('calls the approval queue by what it approves', () => {
    expect(labels(navForWorkplace('education', 'admin'))).toContain('Faculty approvals')
  })

  it('keeps settings inside the workplace', () => {
    const settings = navForWorkplace('education', 'student', false).at(-1)?.items[0]
    expect(settings?.to).toBe('/student/settings')
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/components/app/nav.test.ts`
Expected: FAIL on the first test (the full student rail is returned) and on "Faculty approvals".

- [ ] **Step 3: Narrow the rail** — `src/components/app/nav.ts`

Rename the admin row: `{ label: 'Faculty approvals', icon: 'shield', to: '/admin/approvals' },`.

Above `GENERAL_NAV`, add:

```ts
/**
 * A student nobody has let in yet. Every other row would open onto an empty
 * page, so the rail offers only the dashboard, whose one job for them is
 * joining a class.
 */
const STUDENT_WAITING: NavGroup[] = [
  { title: 'Workspace', items: [{ label: 'Dashboard', icon: 'board', to: '/student' }] },
  SETTINGS,
]
```

Replace `navForWorkplace` with:

```ts
/**
 * An account with no Education role only ever sees General's rail. `admitted`
 * narrows only a student's Education rail; faculty are admitted by approval,
 * which the route guard has already checked.
 */
export function navForWorkplace(
  workplace: Workplace,
  role: Role | null,
  admitted = true,
): NavGroup[] {
  const groups =
    workplace === 'general' || !role
      ? GENERAL_NAV
      : role === 'student' && !admitted
        ? STUDENT_WAITING
        : BY_ROLE[role]
  const settingsPath = settingsPathFor(workplace, role)
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.to === '/settings' ? { ...item, to: settingsPath } : item,
    ),
  }))
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/components/app/nav.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Pass admission from the shell** — `src/components/app/SideNav.tsx`

Add `import { useAdmission } from '../../hooks/useAdmission'`. After the `useUnreadTotal` line (before the `if (!profile) return null` early return, so hook order stays fixed), add:

```ts
  const admitted = useAdmission(profile?.role === 'student' ? profile.id : undefined)
```

Replace the `groups` line with:

```ts
  // Null while it loads counts as admitted, so the rail never flashes empty
  // for a student who has classes.
  const groups = navForWorkplace(
    workplace,
    profile.status === 'active' ? profile.role : null,
    admitted !== false,
  )
```

- [ ] **Step 6: Extract the join dialog** — `src/components/classes/JoinClassDialog.tsx`

```tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { JOIN_MESSAGE, joinClass } from '../../lib/api/classes'
import { authErrorMessage } from '../../lib/authError'

/**
 * Entering a class code. The one thing a student can do before anybody has let
 * them in, so it opens from the dashboard as well as the classes page.
 */
export function JoinClassDialog({
  open,
  onClose,
  onJoined,
}: {
  open: boolean
  onClose: () => void
  onJoined?: () => void | Promise<void>
}) {
  const { show } = useToast()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setCode('')
    setError(null)
    onClose()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { result, class_id } = await joinClass(code)
      if (result === 'joined') {
        close()
        show('You joined the class')
        await onJoined?.()
        if (class_id) navigate(`/student/classes/${class_id}`)
      } else if (result === 'already_member' && class_id) {
        close()
        navigate(`/student/classes/${class_id}`)
      } else {
        setError(JOIN_MESSAGE[result])
      }
    } catch (err) {
      setError(authErrorMessage(err, 'Could not join that class.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Join a class"
      description="Enter the code your professor gave you."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button form="join-class" type="submit" loading={busy} className="!rounded-xl">
            Join class
          </Button>
        </>
      }
    >
      <form id="join-class" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Class code">
          {(id) => (
            <Input
              id={id}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="DBM-7823"
              autoComplete="off"
              className="font-mono tracking-widest"
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 7: Use it on the classes page** — `src/pages/app/classes/StudentClasses.tsx`

Delete the `code`, `busy` and `joinError` state, the `submit` function and the whole `<Modal …>…</Modal>` block. Replace the modal with:

```tsx
      <JoinClassDialog open={joinOpen} onClose={() => setJoinOpen(false)} onJoined={load} />
```

Add `import { JoinClassDialog } from '../../../components/classes/JoinClassDialog'`. Remove the imports that are now unused: `FormEvent`, `useNavigate`, `Field`, `Input`, `Modal`, `useToast`, `JOIN_MESSAGE`, `joinClass`, and `navigate`/`show` if nothing else uses them. `npx tsc -b` lists anything missed.

- [ ] **Step 8: Join from the dashboard** — `src/pages/app/StudentHome.tsx`

Add `import { useState } from 'react'` (merge into the existing `react` import), `import { Button } from '../../components/ui/Button'` (merge with the existing `ButtonLink` import), and `import { JoinClassDialog } from '../../components/classes/JoinClassDialog'`.

After `const unread = useUnreadTotal(profile?.id)`, add `const [joinOpen, setJoinOpen] = useState(false)`.

In the `data.classes.length === 0` branch, replace the `EmptyState`'s `body` and `action` with:

```tsx
              body="Enter the code your professor gives you. Your projects, groups and tasks arrive with the class."
              action={
                <Button onClick={() => setJoinOpen(true)} className="!rounded-xl">
                  Join a class
                </Button>
              }
```

Directly before the component's final closing `</div>`, add:

```tsx
      <JoinClassDialog open={joinOpen} onClose={() => setJoinOpen(false)} onJoined={reload} />
```

Remove `ButtonLink` from the import if nothing else in the file uses it.

- [ ] **Step 9: Build and test**

Run: `npm run build && npx vitest run`
Expected: build succeeds; every test passes, including the 5 new ones.

- [ ] **Step 10: Commit**

```bash
git add src/components/app/nav.ts src/components/app/nav.test.ts src/components/app/SideNav.tsx src/components/classes/JoinClassDialog.tsx src/pages/app/classes/StudentClasses.tsx src/pages/app/StudentHome.tsx
git commit -F - <<'MSG'
Give a student nobody has let in one thing to do: join a class

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 7: Faculty approvals with Can teach, and faculty-only create and join

**Files:**
- Modify: `src/pages/app/admin/ProfessorApprovals.tsx`, `src/pages/app/admin/Accounts.tsx:275`, `src/pages/app/classes/ProfessorClasses.tsx`, `src/pages/general/GeneralHome.tsx`, `src/pages/general/SpacePicker.tsx`, `src/pages/general/GeneralProjects.tsx`

**Interfaces:**
- Consumes: `decideFaculty`, `setFacultyTeaching` (Task 4), `isFaculty`, `canTeach` (Task 4), `ProfessorAccount.can_teach` (Task 4).

- [ ] **Step 1: Approvals page** — `src/pages/app/admin/ProfessorApprovals.tsx`

Import `decideFaculty, listProfessorAccounts, setFacultyTeaching` from `../../../lib/api/admin`.

Add state after `busy`: `const [teach, setTeach] = useState<Record<string, boolean>>({})`. The default is **on**: most faculty sign-ups at a school are professors, so approving somebody who teaches should be one click.

Replace `decide` with:

```tsx
  async function decide(account: ProfessorAccount, approve: boolean) {
    setBusy(account.id)
    try {
      // Teaching is only sent with a first approval. A turn-down, or putting a
      // settled account back, keeps whatever was set.
      const canTeach = approve && account.status === 'pending' ? (teach[account.id] ?? true) : undefined
      await decideFaculty(account.id, approve, canTeach)
      show(approve ? `${fullName(account)} approved` : `${fullName(account)} turned down`)
      setRejecting(null)
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not record that.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function toggleTeaching(account: ProfessorAccount) {
    setBusy(account.id)
    try {
      await setFacultyTeaching(account.id, !account.can_teach)
      show(
        account.can_teach
          ? `${fullName(account)} can no longer open classes`
          : `${fullName(account)} can open classes`,
      )
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change teaching.'), 'error')
    } finally {
      setBusy(null)
    }
  }
```

Copy changes:
- `document.title = 'Faculty approvals · Collabify'`
- DirectoryHero `description="Review faculty sign-ups before their tools unlock, and decide who can open classes."`
- First stat label `'Faculty'`
- Waiting EmptyState `body="New faculty sign-ups land here for review before anything unlocks for them."`

In the waiting row, directly before `<span className="flex flex-wrap gap-2">`, add:

```tsx
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[13px] text-ink">
                    <input
                      type="checkbox"
                      checked={teach[a.id] ?? true}
                      disabled={busy === a.id}
                      onChange={(e) => setTeach((t) => ({ ...t, [a.id]: e.target.checked }))}
                    />
                    Can teach
                  </label>
```

In the settled row, after the status badge `<span … {LABEL[a.status]}</span>`, add:

```tsx
                {a.status === 'active' && (
                  <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 font-mono text-[12px] text-muted">
                    {a.can_teach ? 'Teaches' : 'Does not teach'}
                  </span>
                )}
```

Before the settled row's existing ghost button, add:

```tsx
                {a.status === 'active' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === a.id}
                    onClick={() => void toggleTeaching(a)}
                  >
                    {a.can_teach ? 'Stop teaching' : 'Allow teaching'}
                  </Button>
                )}
```

In the ConfirmDialog body, change "cannot open a class or see any group" to "cannot open a class, a space or any group".

In `src/pages/app/admin/Accounts.tsx:275`, change `Professor approvals` to `Faculty approvals`.

- [ ] **Step 2: Create class only when teaching** — `src/pages/app/classes/ProfessorClasses.tsx`

Add `import { canTeach } from '../../../lib/access'`, and after `const { profile } = useAuth()` add `const teaching = canTeach(profile)`.

DirectoryHero `action`: `action={teaching ? (<Button …>Create class</Button>) : undefined}`, keeping the existing button JSX inside.

EmptyState for the active view: set `body` to

```tsx
              view === 'active'
                ? teaching
                  ? 'Create your first class and share its code with your section. Students join with the code — you never add them by hand.'
                  : 'Classes open once the program admin turns on teaching for your account. Work spaces are open to you now, in General.'
                : 'Archived classes disappear for students but stay here for your records.'
```

and change the `action` condition to `view === 'active' && teaching ? (…) : undefined`.

- [ ] **Step 3: General — faculty create and join, students are invited**

`src/pages/general/GeneralHome.tsx`: add `import { isFaculty } from '../../lib/access'` and, after the `useAuth()` line, `const faculty = isFaculty(profile)`. Replace the first two entries of the `QuickActions` `actions` array (New space, Join with code) with:

```tsx
            ...(faculty
              ? [
                  {
                    icon: 'plus' as const,
                    label: 'New space',
                    hint: 'A place to hold projects',
                    onClick: () => setNewSpaceOpen(true),
                    primary: true,
                  },
                  {
                    icon: 'lock' as const,
                    label: 'Join with code',
                    hint: 'Eight characters from an Owner',
                    onClick: () => setJoinOpen(true),
                  },
                ]
              : []),
```

In the "Nothing here yet" block, replace the paragraph text with `{faculty ? 'Make a space to hold your own projects, or join a project somebody else runs with the code they give you.' : 'A faculty member can invite you into a space or onto a project. Your classes are in Education.'}` and wrap the button row `<div className="mt-4 flex flex-wrap gap-2">…</div>` in `{faculty && (…)}`.

`src/pages/general/SpacePicker.tsx`: add `import { useAuth } from '../../context/AuthContext'` and `import { isFaculty } from '../../lib/access'`, and inside the component `const { profile } = useAuth()` and `const faculty = isFaculty(profile)`. Change the DirectoryHero `action` condition from `!viewingArchived ?` to `!viewingArchived && faculty ?`. For the empty state: set `action` to `!viewingArchived && faculty ? (…) : undefined`, and make the non-archived `body` `faculty ? 'Create one to hold your projects, or join a space somebody else has opened with a code.' : 'A faculty member can invite you into a space.'`.

`src/pages/general/GeneralProjects.tsx`: add `useAuth` and `isFaculty` imports as above, with `const faculty = isFaculty(profile)`. Change the DirectoryHero `action` to `faculty ? (<Button …>Join with code</Button>) : undefined`, keeping the existing button, and render `<JoinProjectDialog …/>` only when `faculty`. Change the "No projects yet" body to `faculty ? 'Projects appear here after you create one or accept an invitation.' : 'Projects appear here after a faculty member invites you to one.'`.

- [ ] **Step 4: Build and test**

Run: `npm run build && npx vitest run`
Expected: build succeeds; every test passes.

- [ ] **Step 5: Commit**

```bash
git add src/pages/app/admin/ProfessorApprovals.tsx src/pages/app/admin/Accounts.tsx src/pages/app/classes/ProfessorClasses.tsx src/pages/general/GeneralHome.tsx src/pages/general/SpacePicker.tsx src/pages/general/GeneralProjects.tsx
git commit -F - <<'MSG'
Decide teaching at approval, and offer create and join only to faculty

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

### Task 8: End-to-end verification

**Files:** none changed, unless a check fails. Fix there, re-run, and commit the fix on its own.

- [ ] **Step 1: Full checks**

Run: `npm run build && npx vitest run && node scripts/schema-drift.mjs | tail -2`
Expected: build passes; every vitest test passes; drift summary prints.

Run the SQL suite loop from Task 3 Step 1.
Expected: 37 files, all `✓`.

- [ ] **Step 2: Live data sanity**

Run:
```bash
node scripts/db.mjs -c "select role, status, can_teach, count(*) from public.profiles group by 1,2,3 order by 1,2"
```
Expected: 21 active students (`can_teach` false), 2 active professors (`can_teach` true), 1 admin. Compare with the Task 1 snapshot: no role or status changed.

- [ ] **Step 3: Browser walk** (`preview_start` with the dev server; test accounts created with the project's seed approach, never real credentials)

For each account, check the page and rail with `read_page`:
1. **New student** (register as Student): lands on `/student`, the rail shows Dashboard and Settings only, the dashboard's "Join a class" opens the dialog, and a real class code joins, after which the full rail appears without a reload (live update).
2. **New faculty** (register as Faculty): lands on `/pending` with "Waiting on approval" and no General link. `/general` and `/professor` both redirect to `/pending`, while `/settings` still opens.
3. **Admin** at `/admin/approvals`: the page title is "Faculty approvals", the new account is waiting with *Can teach* ticked, and approving with it unticked gives "Does not teach" plus "Allow teaching", which flips it. `/admin/audit` shows the teaching change.
4. **Faculty without teaching**: `/professor/classes` has no Create class button and shows the teaching message. `/general/spaces` offers Create space.
5. **Existing student in General**: `/general`, `/general/spaces` and `/general/projects` show no New space or Join with code, and the empty-state copy mentions being invited.

- [ ] **Step 4: Push**

Run: `git push origin main`
Expected: the push succeeds (standing authorization for this repo).
