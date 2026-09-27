# One workplace, phase 3b: the education space page — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A class opens as an education space: one page with tabs for everyone (Overview, Projects, Groups, Members, Syllabus) and more for the faculty who teach it (Submissions, Analytics, Reports, Settings). Co-teachers get a screen, sit in the class chat and see their co-taught classes everywhere a professor's classes are listed. New space asks Education or Work.

**Architecture:** The URL stays `/classes/:classId`, with the tab in `?tab=`. One page, `ClassSpace`, replaces `StudentClassDetail` and `ProfessorClassDetail`. Who teaches is decided by a pure `teachesClass()` that mirrors the SQL `is_class_professor`. The three cross-class faculty pages take an optional `classId` prop that locks them to one class and hides their hero, so the space page embeds them instead of copying them. In SQL, faculty who enter a class space always sit at Owner or Manager, and a trigger keeps the class conversation in step with those seats.

**Tech stack:** React 19 + TypeScript + Vite + React Router + Tailwind v4 tokens, Supabase/Postgres (SQL via `node scripts/db.mjs`), Vitest (node env, `src/**/*.test.ts`, pure functions only).

**Spec:** `docs/superpowers/specs/2026-09-26-one-workplace-design.md`, sections 2 and 3.

**Decisions this plan makes (from the spec, stated here so no task re-decides them):**
- Faculty in a class space are always Owner or Manager: "faculty hold owner or manager (co-teachers and advisers)". Accepting an invitation to a class space seats faculty at Manager, and nobody can set faculty to Member there. This replaces the phase-2 behaviour where invited faculty sat at Member, so two phase-2 test assertions change (Task 1).
- Space-level student positions are **not** in this plan. Positions exist only on projects today, and work spaces don't have them either. They're listed as a follow-up in the handoff.
- The phase 3a browser walk was never run. It folds into this plan's final walk (Task 8), so the owner signs in once per role for both.
- Admins keep the current behaviour on `/classes/:classId` (RoleSwitch sends them Home). The open question of whether admins without Can teach keep "New message" is still the owner's to answer, and nothing here changes it.

## Global constraints

- Don't change the visual design. Reuse the existing components (`ClassHeader`, `Tabs variant="panel"`, `AnnouncementFeed`, `RosterTable`, `ClassGroupsTab`, `ClassProjectsTab`, `ClassSyllabusTab`, `ClassAbout`, `ClassForm`, `TermStrip`, `Modal`, `ConfirmDialog`, `Alert`, `EmptyState`, `Button`, `Select`, `Avatar`) and tokens. No new colours and no raw hex. Education badges use the amber ramp (`bg-amber-400/18 text-amber-700 dark:text-amber-300`), work badges use `surface-sunken text-muted`, exactly as `SideNav.tsx` does.
- Every URL comes from `src/lib/paths.ts`. No source file outside `paths.ts` and its test contains a string literal starting with `/student`, `/professor` or `/general`.
- The role value stays `'professor'`. The UI says Faculty.
- Copy rules (CLAUDE.md): sentence case, active voice, no exclamation marks, no "please", no "successfully".
- Reduced motion stays honoured. Desktop layout comes first, then tablet, then phone.
- `supabase/*.sql` stays idempotent. After changing SQL, re-run `supabase/anon-lockdown.sql` last, then its test.
- Never read or print `.env.local`, `SUPABASE_DB_URL` or `SUPABASE_SERVICE_ROLE_KEY`. Don't stage `desktop.ini`, `docs/redesign/`, `.superpowers/`, `*.patch`, `graphify-out`, `verify-before-main.md` or `supabase/.temp/`.
- **Never sign in, sign out or register in any browser.** The browser pane's session belongs to the owner.
- `npm run build` and `npx vitest run` pass before a task is called done. Commits use a heredoc message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` on its own line after a blank line. Don't push; the controller pushes.

## File map

| File | Change | Task |
|---|---|---|
| `supabase/one-workplace.sql` | faculty seats in class spaces, class chat follows them, `search_faculty` | 1 |
| `supabase/tests/one-workplace.test.sql` | two assertions updated, new block | 1 |
| `docs/superpowers/specs/2026-09-26-one-workplace-design.md` | co-teacher sentence | 1 |
| `src/lib/classSpace.ts` (+ test) | `teachingClassFilter` (T2); `teachesClass`, `classTabs`, `readClassTab` (T6) | 2, 6 |
| `src/lib/api/classes.ts` | `listProfessorClasses` includes co-taught classes | 2 |
| `src/pages/app/submissions/Submissions.tsx` | optional `classId` prop | 3 |
| `src/pages/app/analytics/Analytics.tsx`, `useAnalytics.ts`, `src/components/analytics/FilterChain.tsx` | optional `classId` prop / `lockClass` | 3 |
| `src/pages/app/reports/Reports.tsx`, `useReports.ts`, `src/components/reports/ReportPicker.tsx` | optional `classId`; class select only when there's a choice | 3 |
| `src/lib/api/spaces.ts` | `searchFaculty` | 4 |
| `src/components/general/InviteToSpaceDialog.tsx` | extracted from `SpaceMembers.tsx`, with a `search` prop | 4 |
| `src/pages/general/SpaceMembers.tsx` | uses the extracted dialog | 4 |
| `src/components/classes/FacultyPanel.tsx` | new | 4 |
| `src/components/classes/ClassForm.tsx` | keeps a class's current syllabus/curriculum choosable | 5 |
| `src/components/classes/ClassSettings.tsx` | new | 5 |
| `src/components/dashboard/TermStrip.tsx` | optional `hrefFor` | 6 |
| `src/pages/app/classes/ClassSpace.tsx` | new; replaces the two detail pages | 6 |
| `src/pages/app/classes/StudentClassDetail.tsx`, `ProfessorClassDetail.tsx` | deleted | 6 |
| `src/App.tsx` | `/classes/:classId` renders `ClassSpace` | 6 |
| `src/components/general/SpaceDialogs.tsx` | `NewSpaceDialog` asks the kind | 7 |
| `src/pages/app/classes/ProfessorClasses.tsx` | "Create class" opens `NewSpaceDialog` at Education | 7 |
| `handoff.md` | phase 3a + 3b section | 8 |

---

### Task 1: Faculty seats in a class space, the class chat, and a faculty search

**Files:**
- Modify: `supabase/one-workplace.sql`: replace `guard_class_space_member`, edit one comment, and append a new `begin; … commit;` block at the end of the file.
- Modify: `supabase/tests/one-workplace.test.sql`
- Modify: `docs/superpowers/specs/2026-09-26-one-workplace-design.md`

**Interfaces:**
- Produces: SQL `public.search_faculty(p_query text) returns table (person_id uuid, first_name text, last_name text, avatar_url text, email text)`, the same shape as `search_general_people`. Task 4 wraps it.
- Produces: behaviour. Faculty who join a class space land at Manager, and faculty can't be set to Member there. Faculty at Owner/Manager in a class space are members of the class conversation, and leaving the seat takes them out.

- [ ] **Step 1: Update the two phase-2 assertions that the new rule changes**

In `supabase/tests/one-workplace.test.sql`:

(a) Fixture comment: change `v_staff    uuid := gen_random_uuid();  -- faculty, stays a plain member` to `v_staff    uuid := gen_random_uuid();  -- faculty, joins and is removed again`.

(b) In the block headed `-- nothing else writes a class's space`, replace

```sql
  perform pg_temp.must_be('...and joins it as a member',
    (select level = 'member' from public.general_space_members
      where space_id = v_space and user_id = v_cot));
```

with

```sql
  perform pg_temp.must_be('...and joins it as a Manager, since faculty in a class teach it',
    (select level = 'manager' from public.general_space_members
      where space_id = v_space and user_id = v_cot));
```

(c) In the block headed `-- co-teachers`:

- Change the comment `-- Staff comes in as a plain member; the co-teacher is raised to Manager.` to `-- Staff comes in too. Faculty in a class sit at Manager.`
- Delete these lines, since cot is already a Manager:

```sql
  perform pg_temp.act_as(v_cot);
  perform pg_temp.must_be('a faculty member of the class space is not a co-teacher yet',
    not public.is_class_professor(v_class));

  perform pg_temp.act_as(v_teacher);
  perform public.set_general_space_level(v_space, v_cot, 'manager');
```

- Replace

```sql
  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_be('a faculty Member of the space is not a co-teacher',
    not public.is_class_professor(v_class));
```

with

```sql
  perform pg_temp.act_as(v_teacher);
  perform public.remove_general_space_member(v_space, v_staff);
  perform pg_temp.act_as(v_staff);
  perform pg_temp.must_be('faculty removed from the class space no longer teach it',
    not public.is_class_professor(v_class));
```

Leave the two lines after it (`update … 'Zz edited by staff'` and the `...and cannot edit the class` check) as they are.

- [ ] **Step 2: Append the new test block before the final `rollback;`**

```sql
-- ------------------------------------------------------------------ faculty seats and the class chat

do $$
declare
  v_teacher uuid := (select v from fx where k = 'teacher');
  v_cot     uuid := (select v from fx where k = 'cot');
  v_staff   uuid := (select v from fx where k = 'staff');
  v_s1      uuid := (select v from fx where k = 's1');
  v_class   uuid := (select v from fx where k = 'class');
  v_space   uuid := (select v from fx where k = 'space');
  v_convo   uuid;
  v_inv     uuid;
begin
  perform pg_temp.act_as_service();
  select id into v_convo from public.conversations where class_id = v_class and kind = 'class';

  perform pg_temp.must_be('a co-teacher sits in the class chat',
    exists (select 1 from public.conversation_members
             where conversation_id = v_convo and user_id = v_cot));

  -- Staff was removed in the co-teacher block; bring them back.
  perform pg_temp.act_as(v_teacher);
  perform public.invite_to_general_space(v_space, v_staff);
  perform pg_temp.act_as(v_staff);
  select id into v_inv from public.general_space_invitations
   where space_id = v_space and invitee = v_staff and status = 'pending';
  perform public.respond_general_space_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('faculty who accept a class invitation sit at Manager',
    (select level = 'manager' from public.general_space_members
      where space_id = v_space and user_id = v_staff));
  perform pg_temp.must_be('...and join the class chat',
    exists (select 1 from public.conversation_members
             where conversation_id = v_convo and user_id = v_staff));

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_refuse('faculty cannot be set to Member in a class space', format(
    'select public.set_general_space_level(%L, %L, %L)', v_space, v_staff, 'member'));

  perform public.remove_general_space_member(v_space, v_staff);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('removing a co-teacher takes them out of the class chat',
    not exists (select 1 from public.conversation_members
                 where conversation_id = v_convo and user_id = v_staff));
  perform pg_temp.must_be('...and leaves the students in it',
    exists (select 1 from public.conversation_members
             where conversation_id = v_convo and user_id = v_s1));

  perform pg_temp.act_as(v_teacher);
  perform pg_temp.must_be('faculty search finds faculty',
    exists (select 1 from public.search_faculty('Zz') where person_id = v_cot));
  perform pg_temp.must_be('...and never a student',
    not exists (select 1 from public.search_faculty('Zz') where person_id = v_s1));
  perform pg_temp.act_as(v_s1);
  perform pg_temp.must_refuse('a student cannot search faculty',
    $q$select * from public.search_faculty('Zz')$q$);

  -- Handover last: it takes the old professor out of the space entirely.
  perform pg_temp.act_as_service();
  update public.classes set professor_id = v_cot where id = v_class;
  perform pg_temp.must_be('a handover keeps the new professor in the class chat',
    exists (select 1 from public.conversation_members
             where conversation_id = v_convo and user_id = v_cot));
  perform pg_temp.must_be('...and takes the old one out',
    not exists (select 1 from public.conversation_members
                 where conversation_id = v_convo and user_id = v_teacher));
end $$;
```

- [ ] **Step 3: Run the suite and see it fail**

Run: `node scripts/db.mjs supabase/tests/one-workplace.test.sql`
Expected: FAIL at `...and joins it as a Manager, since faculty in a class teach it`.

- [ ] **Step 4: Replace `guard_class_space_member` in `supabase/one-workplace.sql`**

Replace the whole `create or replace function public.guard_class_space_member()` definition, including its doc comment, with the version below. The trigger statements after it stay as they are.

```sql
/**
 * Who sits in a class's space. Students arrive and leave through the roster.
 * The class's professor stays its Owner until the admin hands the class over.
 * Other faculty come and go the General way, but always as Owner or Manager:
 * faculty in a class teach it (co-teachers and advisers alike), so an accepted
 * invitation seats them at Manager and nobody can set them to Member.
 */
create or replace function public.guard_class_space_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sid  uuid := case when tg_op = 'DELETE' then old.space_id else new.space_id end;
  prof uuid;
begin
  -- Before the sync/service bypass, so the rule holds however the row arrives.
  if tg_op = 'INSERT' and public.is_education_space(sid)
     and not public.is_student(new.user_id) and new.level = 'member' then
    new.level := 'manager';
  end if;

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
    raise exception 'The class''s professor stays its Owner. Ask the program admin to hand the class to someone else.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and not public.is_student(new.user_id) and new.level = 'member' then
    raise exception 'Faculty in a class are Owner or Manager. Remove them instead.'
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
```

- [ ] **Step 5: Update the stale comment on `is_class_professor`**

In the doc comment above `create or replace function public.is_class_professor`, replace the two lines

```
 * Co-teachers can moderate the class conversation but are not yet its members;
 * phase 3 adds them.
```

with

```
 * Co-teachers sit in the class conversation too (class_space_conversation_sync).
```

- [ ] **Step 6: Append the new block at the end of `supabase/one-workplace.sql`**

```sql
begin;

-- ---------------------------------------------------------------- faculty seats follow the class chat

/**
 * Whoever teaches a class sits in its conversation. Students come and go with
 * the roster (messages.sql's sync_class_conversation_member); faculty come and
 * go with their Owner/Manager seat in the class's space, which also covers a
 * handover, since class_space_follow moves the Owner seat.
 *
 * A class being created has no conversation yet when its Owner seat is written
 * (the space is made before the class row exists); create_class_conversation
 * seats the professor then. A class being deleted has already gone, so there
 * is nothing to update.
 */
create or replace function public.class_space_conversation_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sid   uuid := case when tg_op = 'DELETE' then old.space_id else new.space_id end;
  convo uuid;
begin
  select x.id into convo
    from public.classes c
    join public.conversations x on x.class_id = c.id and x.kind = 'class'
   where c.space_id = sid;
  if convo is null then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and not public.is_student(old.user_id)
     and (tg_op = 'DELETE' or new.level not in ('owner', 'manager')) then
    delete from public.conversation_members
     where conversation_id = convo and user_id = old.user_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and not public.is_student(new.user_id)
     and new.level in ('owner', 'manager') then
    insert into public.conversation_members (conversation_id, user_id)
    values (convo, new.user_id)
    on conflict do nothing;
  end if;

  return null;
end;
$$;

drop trigger if exists general_space_members_class_chat on public.general_space_members;
create trigger general_space_members_class_chat
  after insert or update of level or delete on public.general_space_members
  for each row execute function public.class_space_conversation_sync();

-- Faculty who joined a class space before seats were fixed at Manager.
update public.general_space_members m
   set level = 'manager'
  from public.general_spaces s
 where s.id = m.space_id
   and s.kind = 'education'
   and m.level = 'member'
   and not public.is_student(m.user_id);

-- Co-teachers already seated, into their class chats.
insert into public.conversation_members (conversation_id, user_id)
select x.id, m.user_id
  from public.general_space_members m
  join public.classes c on c.space_id = m.space_id
  join public.conversations x on x.class_id = c.id and x.kind = 'class'
 where m.level in ('owner', 'manager')
   and not public.is_student(m.user_id)
on conflict do nothing;

-- ---------------------------------------------------------------- finding faculty to invite

/**
 * search_general_people narrowed to approved faculty, for inviting a
 * co-teacher into a class. Only faculty can ask. It shares the people-search
 * rate limit, since it is the same lookup.
 */
create or replace function public.search_faculty(p_query text)
returns table (person_id uuid, first_name text, last_name text, avatar_url text, email text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  if not public.is_faculty(auth.uid()) then
    raise exception 'Only faculty can look up faculty' using errcode = 'insufficient_privilege';
  end if;
  if char_length(q) < 3 then
    return;
  end if;

  perform public.rate_limit('general_people_search', 60, interval '1 minute',
    'Too many searches at once. Wait a minute and try again.');

  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select pr.id, pr.first_name, pr.last_name, pr.avatar_url,
           case when lower(pr.email) = lower(q) then pr.email end
      from public.profiles pr
     where pr.status = 'active'
       and pr.role in ('professor', 'admin')
       and pr.id <> auth.uid()
       and (lower(pr.email) = lower(q)
            or btrim(pr.first_name || ' ' || pr.last_name) ilike pattern)
     order by pr.last_name, pr.first_name
     limit 10;
end;
$$;

revoke execute on function public.search_faculty(text) from public, anon;
grant execute on function public.search_faculty(text) to authenticated, service_role;

commit;
```

Also add `search_faculty` and `class_space_conversation_sync` to the list of what the file defines in its header comment. Append this sentence after "Re-run this file after re-running any of those.":

```
-- Phase 3b adds class_space_conversation_sync (faculty seats drive the class
-- chat) and search_faculty.
```

- [ ] **Step 7: Apply live, lock anon out again, and run the tests**

Run, in order:
```bash
node scripts/db.mjs supabase/one-workplace.sql
node scripts/db.mjs supabase/anon-lockdown.sql
node scripts/db.mjs supabase/tests/one-workplace.test.sql
node scripts/db.mjs supabase/tests/anon-lockdown.test.sql
```
Expected: every line `PASS`, no `FAIL`.

Then run every suite: `for f in supabase/tests/*.test.sql; do node scripts/db.mjs "$f" 2>&1 | grep -E "FAIL|ERROR" && echo "in $f"; done`
Expected: no output (40 suites clean).

- [ ] **Step 8: Update the spec sentence**

In `docs/superpowers/specs/2026-09-26-one-workplace-design.md`, section 3, replace `Co-teachers can moderate the class conversation but are not yet its members; phase 3 adds them.` with `Faculty in a class space always sit at Owner or Manager (an accepted invitation seats them at Manager), and those seats put them in the class conversation.`

- [ ] **Step 9: Commit**

```bash
git add supabase/one-workplace.sql supabase/tests/one-workplace.test.sql docs/superpowers/specs/2026-09-26-one-workplace-design.md
git commit -F - <<'EOF'
Seat faculty in a class at Manager and give them the class chat

Faculty who accept a class invitation now sit at Manager, and nobody can set
them to Member there. Their Owner/Manager seat puts them in the class
conversation and leaving it takes them out, handovers included. Adds
search_faculty for inviting co-teachers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Co-taught classes wherever a professor's classes are listed

**Files:**
- Create: `src/lib/classSpace.ts`, `src/lib/classSpace.test.ts`
- Modify: `src/lib/api/classes.ts:14-27` (`listProfessorClasses`)

**Interfaces:**
- Produces: `teachingClassFilter(userId: string, spaceIds: string[]): string | null`, a PostgREST `or` filter or null when there are no seats.
- Produces: `listProfessorClasses(professorId, archived)` keeps its signature and return type. It now also returns classes whose space holds the user at Owner or Manager. Every existing caller (Submissions, ProjectWizard, ProfessorGroups, ProfessorProjects, ProjectDetail, NewDirectDialog, WorkspaceSearch, useProfessorDashboard, ProfessorClasses) picks this up unchanged.

- [ ] **Step 1: Write the failing test** (`src/lib/classSpace.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { teachingClassFilter } from './classSpace'

describe('teachingClassFilter', () => {
  it('is null with no seats, so the caller filters on professor_id alone', () => {
    expect(teachingClassFilter('u1', [])).toBeNull()
  })

  it('asks for their own classes or the classes of the spaces they sit in', () => {
    expect(teachingClassFilter('u1', ['s1', 's2'])).toBe('professor_id.eq.u1,space_id.in.(s1,s2)')
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/lib/classSpace.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/lib/classSpace.ts`**

```ts
/**
 * The classes somebody teaches: the ones they own, and the ones whose space
 * holds them at Owner or Manager (co-teaching). As a PostgREST `or` filter,
 * or null when they hold no seat and professor_id alone answers it.
 *
 * Ids come from the database, never from input, so they need no escaping.
 */
export function teachingClassFilter(userId: string, spaceIds: string[]): string | null {
  if (spaceIds.length === 0) return null
  return `professor_id.eq.${userId},space_id.in.(${spaceIds.join(',')})`
}
```

- [ ] **Step 4: Rewrite `listProfessorClasses` in `src/lib/api/classes.ts`**

Add `import { teachingClassFilter } from '../classSpace'` to the imports, then replace the function:

```ts
/**
 * Every class this person teaches: their own, and the ones they co-teach
 * through a seat in the class's space. RLS lets them read both
 * (classes_select checks teaches_in_space).
 */
export async function listProfessorClasses(professorId: string, archived = false) {
  const { data: seats, error: seatError } = await supabase
    .from('general_space_members')
    .select('space_id')
    .eq('user_id', professorId)
    .in('level', ['owner', 'manager'])
  if (seatError) throw seatError

  const filter = teachingClassFilter(
    professorId,
    (seats ?? []).map((s) => s.space_id as string),
  )
  const base = supabase.from('class_overview').select('*')
  const mine = filter ? base.or(filter) : base.eq('professor_id', professorId)
  const query = mine.order('created_at', { ascending: false })

  const { data, error } = archived
    ? await query.not('archived_at', 'is', null)
    : await query.is('archived_at', null)

  if (error) throw error
  return (data ?? []) as ClassSummary[]
}
```

(The seat query also returns work spaces. `space_id.in.(…)` on `class_overview` only matches class spaces, so no extra kind filter is needed.)

- [ ] **Step 5: Run the tests and build**

Run: `npx vitest run src/lib/classSpace.test.ts && npm run build`
Expected: PASS, and the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/classSpace.ts src/lib/classSpace.test.ts src/lib/api/classes.ts
git commit -F - <<'EOF'
List co-taught classes alongside a professor's own

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Lock Submissions, Analytics and Reports to one class

**Files:**
- Modify: `src/pages/app/submissions/Submissions.tsx`
- Modify: `src/pages/app/analytics/Analytics.tsx`, `src/pages/app/analytics/useAnalytics.ts`, `src/components/analytics/FilterChain.tsx`
- Modify: `src/pages/app/reports/Reports.tsx`, `src/pages/app/reports/useReports.ts`, `src/components/reports/ReportPicker.tsx`

**Interfaces:**
- Produces: `Submissions({ classId }: { classId?: string })`, `Analytics({ classId }: { classId?: string })` and `Reports({ classId }: { classId?: string })`, all default exports. With `classId`, the page:
  - shows that class only;
  - hides its `DirectoryHero`;
  - leaves `document.title` alone (the host page owns it);
  - offers no way to pick another class.

  Without it, behaviour is unchanged. Task 6 renders `<Submissions classId={id} />` etc. inside the class page.
- Produces: `useAnalytics(classId?: string)`, `useReports(professorId: string | undefined, classId?: string)`, `FilterChain` prop `lockClass?: boolean`.

There's no pure logic to unit test here; `npm run build` is the check, plus the controller's browser walk.

- [ ] **Step 1: Submissions**

In `src/pages/app/submissions/Submissions.tsx`:

1. Signature: `export default function Submissions({ classId }: { classId?: string }) {`
2. Title effect:
   ```ts
   useEffect(() => {
     if (!classId) document.title = 'Submissions · Collabify'
   }, [classId])
   ```
3. In `load`, narrow the classes before anything else is fetched, and add `classId` to the `useCallback` deps (`[profile, classId]`):
   ```ts
   const found = (await listProfessorClasses(profile.id)).filter(
     (c) => !classId || c.id === classId,
   )
   ```
   With one class, `classOptions.length > 1` is false, so the Class filter already hides itself.
4. Wrap the `<DirectoryHero … />` element in `{!classId && ( … )}`, and change the next wrapper from `<div className="mt-6 space-y-5">` to `<div className={classId ? 'space-y-5' : 'mt-6 space-y-5'}>`.

- [ ] **Step 2: Analytics**

In `src/components/analytics/FilterChain.tsx`, add `lockClass?: boolean` to the props (destructure it with `lockClass = false`). Wrap the `<FilterField label="Class">…</FilterField>` element in `{!lockClass && ( … )}`, and change `onClear` so a locked chain keeps its class:

```tsx
onClear={() => onChange(lockClass ? { ...EMPTY_SCOPE, classId: scope.classId } : EMPTY_SCOPE)}
```

In `src/pages/app/analytics/useAnalytics.ts`, give the hook an optional class, and keep that class in every scope it's asked to set:

```ts
export function useAnalytics(classId?: string) {
  // …existing state…
  const [scope, setScopeState] = useState<Scope>({ ...EMPTY_SCOPE, classId: classId ?? '' })
  // Locked to one class (inside a class's own page), every narrowing keeps it.
  const setScope = useCallback(
    (next: Scope) => setScopeState(classId ? { ...next, classId } : next),
    [classId],
  )
```

(Replace the existing `const [scope, setScope] = useState<Scope>(EMPTY_SCOPE)` line with the two declarations above. Keep returning `scope` and `setScope` under the same names. `useCallback` is already imported.)

In `src/pages/app/analytics/Analytics.tsx`:

1. Signature: `export default function Analytics({ classId }: { classId?: string }) {`, then `const data = useAnalytics(classId)`.
2. Title effect: `if (!classId) document.title = 'Analytics · Collabify'`, with deps `[classId]`.
3. Wrap `<DirectoryHero … />` in `{!classId && ( … )}`.
4. Pass the chain one class when locked:
   ```tsx
   <FilterChain
     scope={scope}
     onChange={setScope}
     classes={classId ? data.health.filter((c) => c.class_id === classId) : data.health}
     burns={data.burns}
     members={data.members}
     tasks={data.tasks}
     lockClass={Boolean(classId)}
   />
   ```
5. The empty state checks `data.health.length === 0`. When locked, check whether that class is measured:
   ```tsx
   {(classId ? !data.health.some((c) => c.class_id === classId) : data.health.length === 0) ? (
   ```
   keeping the same `<EmptyState … />` it already renders.

- [ ] **Step 3: Reports**

In `src/components/reports/ReportPicker.tsx`, in `About`, only show the class select when there's more than one class to pick from:

```tsx
{needs.includes('class') && r.classes.length > 1 && (
```

In `src/pages/app/reports/useReports.ts`:

```ts
export function useReports(professorId: string | undefined, lockedClassId?: string) {
```

and in `loadClasses`, narrow the rows and add `lockedClassId` to its deps (`[professorId, lockedClassId]`):

```ts
const rows = (await classReports()).filter(
  (row) => !lockedClassId || row.class_id === lockedClassId,
)
```

In `src/pages/app/reports/Reports.tsx`:

1. Signature: `export default function Reports({ classId }: { classId?: string }) {`, then `const r = useReports(profile?.id, classId)`.
2. Title effect: `if (!classId) document.title = 'Reports · Collabify'`, with deps `[classId]`.
3. Inside one class, the cross-class term summary doesn't apply. Build the catalogue after the loading guard:
   ```ts
   const catalogue = classId
     ? CATALOGUE.map((g) => ({ ...g, items: g.items.filter((i) => i.kind !== 'term_summary') })).filter(
         (g) => g.items.length > 0,
       )
     : CATALOGUE
   ```
   and pass `catalogue={catalogue}` to both `ReportBar` and `ReportSidebar`, instead of `CATALOGUE`.
4. Wrap the whole `<div className="print:hidden"> <DirectoryHero … /> </div>` in `{!classId && ( … )}`.

- [ ] **Step 4: Build and test**

Run: `npm run build && npx vitest run`
Expected: build succeeds and all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/app/submissions/Submissions.tsx src/pages/app/analytics src/components/analytics/FilterChain.tsx src/pages/app/reports src/components/reports/ReportPicker.tsx
git commit -F - <<'EOF'
Let Submissions, Analytics and Reports sit inside one class

Each takes an optional classId that narrows it to that class, hides its hero
and removes the class picker, so a class's page can show them as tabs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The Faculty panel: co-teachers on screen

**Files:**
- Modify: `src/lib/api/spaces.ts` (add `searchFaculty`)
- Create: `src/components/general/InviteToSpaceDialog.tsx`, moved out of `src/pages/general/SpaceMembers.tsx`
- Modify: `src/pages/general/SpaceMembers.tsx` (delete the local `InviteDialog` and import the new one)
- Create: `src/components/classes/FacultyPanel.tsx`

**Interfaces:**
- Consumes: SQL `search_faculty` (Task 1). The faculty-seat rule means accepted invitees land at Manager.
- Produces: `searchFaculty(query: string): Promise<PersonHit[]>`.
- Produces: `InviteToSpaceDialog({ open, onClose, spaceId, onDone, search?, title?, description? })`. `search` defaults to `searchPeople`, `title` to `'Invite to this space'`, and `description` to `'They will be able to see every project in it.'`.
- Produces: `FacultyPanel({ cls }: { cls: ClassSummary })`. Task 6 renders it at the top of the Members tab.

- [ ] **Step 1: `searchFaculty`**

In `src/lib/api/spaces.ts`, under `/* ---------------------------------------------------------------- invitations */`, add the function below. Import the `PersonHit` type from `'../general/types'` if the file doesn't already.

```ts
/** Approved faculty only, for inviting a co-teacher into a class. */
export async function searchFaculty(query: string) {
  const { data, error } = await supabase.rpc('search_faculty', { p_query: query })
  if (error) throw error
  return (data ?? []) as PersonHit[]
}
```

- [ ] **Step 2: Extract the invite dialog**

Create `src/components/general/InviteToSpaceDialog.tsx`. Move the body of `InviteDialog` from `SpaceMembers.tsx` into it verbatim, with these changes: it's exported, it's renamed, it takes `search`/`title`/`description`, and its imports are relative to the new location.

```tsx
import { useEffect, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { searchPeople } from '../../lib/api/general'
import { inviteToSpace } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import type { PersonHit } from '../../lib/general/types'

export function InviteToSpaceDialog({
  open,
  onClose,
  spaceId,
  onDone,
  search = searchPeople,
  title = 'Invite to this space',
  description = 'They will be able to see every project in it.',
}: {
  open: boolean
  onClose: () => void
  spaceId: string
  onDone: () => Promise<void>
  search?: (query: string) => Promise<PersonHit[]>
  title?: string
  description?: string
}) {
  const { show } = useToast()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PersonHit[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) return setHits([])
    // Debounced: a search on every keystroke is a request per keystroke.
    const t = setTimeout(() => {
      void search(q)
        .then(setHits)
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [query, open, search])

  async function invite(person: PersonHit) {
    setBusy(person.person_id)
    try {
      await inviteToSpace(spaceId, person.person_id)
      show(`${person.first_name} was invited`)
      await onDone()
      onClose()
      setQuery('')
    } catch (err) {
      show(authErrorMessage(err, 'Could not invite them.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      focusField
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label="Search by name">
          {(id) => (
            <Input
              id={id}
              autoComplete="off"
              placeholder="Start typing a name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </Field>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {hits.map((h) => (
            <li key={h.person_id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Avatar profile={h} size={30} />
              <span className="flex-1 truncate text-[14px]">
                {h.first_name} {h.last_name}
              </span>
              <Button size="sm" loading={busy === h.person_id} onClick={() => void invite(h)}>
                Invite
              </Button>
            </li>
          ))}
          {query.trim().length >= 2 && hits.length === 0 && (
            <li className="px-1 py-2 text-[13px] text-muted">Nobody by that name.</li>
          )}
        </ul>
      </div>
    </Modal>
  )
}
```

Before writing this, compare it with the current `InviteDialog` in `SpaceMembers.tsx`. If that one differs from the code above in anything except the listed changes, keep the current behaviour. In `SpaceMembers.tsx`, delete `function InviteDialog …`, replace `<InviteDialog` with `<InviteToSpaceDialog`, import it from `'../../components/general/InviteToSpaceDialog'`, and remove any imports that are now unused. `tsc` will name them.

- [ ] **Step 3: `FacultyPanel`**

Create `src/components/classes/FacultyPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { InviteToSpaceDialog } from '../general/InviteToSpaceDialog'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon, Spinner } from '../ui/Icon'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useLive } from '../../hooks/useLive'
import {
  listSpaceInvitations,
  listSpaceMembers,
  removeSpaceMember,
  searchFaculty,
  setSpaceLevel,
  withdrawSpaceInvitation,
} from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { LEVELS, levelLabel } from '../../lib/general/permissions'
import type { GeneralLevel } from '../../lib/general/permissions'
import type { SpaceInvitation, SpacePerson } from '../../lib/general/types'
import { paths } from '../../lib/paths'
import type { ClassSummary } from '../../lib/types'

/** Faculty in a class are Owner or Manager; Member is for students. */
const FACULTY_LEVELS = LEVELS.filter((l) => l.value !== 'member')

/**
 * Who teaches the class: its professor and every co-teacher or adviser. They
 * are the faculty in the class's space, which is where their seats live; the
 * students are the roster below this panel.
 */
export function FacultyPanel({ cls }: { cls: ClassSummary }) {
  const { profile } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()

  const [people, setPeople] = useState<SpacePerson[] | null>(null)
  const [invites, setInvites] = useState<SpaceInvitation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [removing, setRemoving] = useState<SpacePerson | null>(null)
  const [leaving, setLeaving] = useState(false)

  const myId = profile?.id
  const myLevel = people?.find((p) => p.user_id === myId)?.level ?? null
  const archived = Boolean(cls.archived_at)
  const canInvite = !archived && (myLevel === 'owner' || myLevel === 'manager')
  const canSetLevels = !archived && myLevel === 'owner'

  const load = useCallback(async () => {
    try {
      const everyone = await listSpaceMembers(cls.space_id)
      setPeople(everyone.filter((p) => !p.is_student))
      const mine = everyone.find((p) => p.user_id === myId)?.level
      setInvites(
        mine === 'owner' || mine === 'manager' ? await listSpaceInvitations(cls.space_id) : [],
      )
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the faculty.'))
      setPeople((p) => p ?? [])
    }
  }, [cls.space_id, myId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_space_members', 'general_space_invitations'])

  async function changeLevel(person: SpacePerson, level: GeneralLevel) {
    try {
      await setSpaceLevel(cls.space_id, person.user_id, level)
      show(`${person.first_name} is now ${levelLabel(level)}`)
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change that.'), 'error')
    }
  }

  async function withdraw(inv: SpaceInvitation) {
    try {
      await withdrawSpaceInvitation(inv.invitation_id)
      show('Invitation withdrawn')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not withdraw that invitation.'), 'error')
    }
  }

  const canRemove = (p: SpacePerson) =>
    canInvite &&
    p.user_id !== myId &&
    p.user_id !== cls.professor_id &&
    (p.level !== 'owner' || myLevel === 'owner')

  return (
    <section className="overflow-hidden rounded-panel border border-line">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-[15px]">
            Faculty
            <span className="ml-2 font-mono text-[12px] text-faint">{people?.length ?? '—'}</span>
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            They teach the class together: its students, projects, grading and class chat.
          </p>
        </div>
        {canInvite && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <Icon name="plus" size={15} />
            Invite faculty
          </Button>
        )}
      </header>

      {error && (
        <div className="px-4 pt-3 sm:px-5">
          <Alert tone="error" onRetry={load}>
            {error}
          </Alert>
        </div>
      )}

      {people === null ? (
        <div className="flex items-center gap-3 px-4 py-4 text-[13px] text-muted sm:px-5">
          <Spinner size={14} />
          Loading faculty…
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <li
              key={p.user_id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
            >
              <Avatar profile={p} size={32} />
              <span className="min-w-[10rem] flex-1 text-[14px]">
                {p.first_name} {p.last_name}
                {p.user_id === myId && <span className="text-faint"> · you</span>}
                {p.user_id === cls.professor_id && (
                  <span className="text-faint"> · class owner</span>
                )}
              </span>
              {canSetLevels && p.user_id !== myId && p.user_id !== cls.professor_id ? (
                <Select
                  aria-label={`Level for ${p.first_name} ${p.last_name}`}
                  value={p.level}
                  options={FACULTY_LEVELS}
                  className="!h-9 !w-[9.5rem] !text-[13px]"
                  onChange={(e) => void changeLevel(p, e.target.value as GeneralLevel)}
                />
              ) : (
                <span className="text-[13px] text-muted">{levelLabel(p.level)}</span>
              )}
              {canRemove(p) && (
                <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                  Remove
                </Button>
              )}
              {p.user_id === myId && p.user_id !== cls.professor_id && (
                <Button size="sm" variant="ghost" onClick={() => setLeaving(true)}>
                  Leave class
                </Button>
              )}
            </li>
          ))}
          {canInvite &&
            invites.map((inv) => (
              <li
                key={inv.invitation_id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
              >
                <Avatar
                  profile={{
                    first_name: inv.invitee_first_name,
                    last_name: inv.invitee_last_name,
                    avatar_url: inv.invitee_avatar_url,
                  }}
                  size={32}
                />
                <span className="min-w-[10rem] flex-1 text-[14px]">
                  {inv.invitee_first_name} {inv.invitee_last_name}
                  <span className="text-faint"> · invited</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => void withdraw(inv)}>
                  Withdraw
                </Button>
              </li>
            ))}
        </ul>
      )}

      <InviteToSpaceDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        spaceId={cls.space_id}
        onDone={load}
        search={searchFaculty}
        title="Invite faculty"
        description="They teach this class with you and join its class chat once they accept."
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          try {
            await removeSpaceMember(cls.space_id, removing.user_id)
            show(`${removing.first_name} no longer teaches ${cls.name}`)
            await load()
          } catch (err) {
            show(authErrorMessage(err, 'Could not remove them.'), 'error')
          }
        }}
        title={removing ? `Remove ${removing.first_name} from ${cls.name}?` : ''}
        body="They stop seeing the class, its students and its chat. Their past comments and grading stay."
        confirmLabel="Remove"
      />

      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        onConfirm={async () => {
          if (!myId) return
          try {
            await removeSpaceMember(cls.space_id, myId)
            show(`You left ${cls.name}`)
            navigate(paths.classes)
          } catch (err) {
            show(authErrorMessage(err, 'Could not leave the class.'), 'error')
          }
        }}
        title={`Leave ${cls.name}?`}
        body="You stop seeing the class, its students and its chat. Its Owner can invite you back."
        confirmLabel="Leave class"
      />
    </section>
  )
}
```

Before relying on the component props, check them: `Alert` has `onRetry` (Analytics uses it), `ConfirmDialog` takes `open/onClose/onConfirm/title/body/confirmLabel` (ProfessorClassDetail uses them), and `Select` accepts `aria-label` (ReportPicker passes it). If `ConfirmDialog.title` doesn't accept an empty string, pass `removing ? … : 'Remove'` instead.

- [ ] **Step 4: Build and test**

Run: `npm run build && npx vitest run`
Expected: the build succeeds and all tests pass. Also confirm `grep -n "function InviteDialog" src/pages/general/SpaceMembers.tsx` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/spaces.ts src/components/general/InviteToSpaceDialog.tsx src/pages/general/SpaceMembers.tsx src/components/classes/FacultyPanel.tsx
git commit -F - <<'EOF'
Show a class's faculty, and let its Owner invite co-teachers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Class settings as a tab

**Files:**
- Modify: `src/components/classes/ClassForm.tsx` (`asOptions`)
- Create: `src/components/classes/ClassSettings.tsx`

**Interfaces:**
- Produces: `ClassSettings({ cls, onChanged }: { cls: ClassSummary; onChanged: () => Promise<void> })`. Task 6 renders it as the Settings tab. It decides for itself whether the viewer may delete the class (only `cls.professor_id === profile.id`, matching the `classes_delete` policy).

- [ ] **Step 1: Keep the current syllabus and curriculum choosable**

A co-teacher doesn't own the class's syllabus, so it's in neither of their lists. The native select would then show the placeholder ("No syllabus") even though saving keeps the id. In `ClassForm.tsx`, replace `asOptions` with:

```ts
  const asOptions = (rows: TeachingResource[], kind: 'syllabus' | 'curriculum') => {
    const options = [
      ...rows.map((r) => ({ value: r.id, label: r.title })),
      ...published
        .filter((r) => r.kind === kind)
        .filter((r) => !rows.some((own) => own.id === r.id))
        .map((r) => ({ value: r.id, label: `Program · ${r.title}` })),
    ]
    // A co-teacher does not own the class's syllabus, so it is in neither list.
    // Offer it as it stands rather than a field that reads "No syllabus".
    const current = kind === 'syllabus' ? defaults?.syllabus_id : defaults?.curriculum_id
    if (current && !options.some((o) => o.value === current)) {
      options.unshift({ value: current, label: `The class's current ${kind}` })
    }
    return options
  }
```

Every existing call already passes the kind (`asOptions(syllabi, 'syllabus')`, `asOptions(curricula, 'curriculum')`), so nothing else changes.

- [ ] **Step 2: `ClassSettings`**

Create `src/components/classes/ClassSettings.tsx`. The edit, archive and delete behaviour, and all the copy, move here unchanged from `ProfessorClassDetail.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClassForm } from './ClassForm'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { deleteClassPermanently, setArchived, updateClass } from '../../lib/api/classes'
import type { ClassInput } from '../../lib/api/classes'
import { listResources } from '../../lib/api/resources'
import { authErrorMessage } from '../../lib/authError'
import { paths } from '../../lib/paths'
import type { ClassSummary, TeachingResource } from '../../lib/types'

/**
 * Everything about a class that its faculty can change, in one tab: the
 * details it was made with, archiving, and (for the professor who owns it)
 * deleting it. The join code is on the header and never changes.
 */
export function ClassSettings({
  cls,
  onChanged,
}: {
  cls: ClassSummary
  onChanged: () => Promise<void>
}) {
  const { profile } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()
  const ownsClass = profile?.id === cls.professor_id

  const [syllabi, setSyllabi] = useState<TeachingResource[]>([])
  const [curricula, setCurricula] = useState<TeachingResource[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [archivePrompt, setArchivePrompt] = useState(false)
  const [deletePrompt, setDeletePrompt] = useState(false)

  useEffect(() => {
    if (!profile) return
    void Promise.all([listResources(profile.id, 'syllabus'), listResources(profile.id, 'curriculum')])
      .then(([s, c]) => {
        setSyllabi(s)
        setCurricula(c)
      })
      .catch(() => {
        // The dropdowns stay as they are; saving the other fields does not need them.
      })
  }, [profile])

  async function save(input: ClassInput) {
    setError(null)
    setBusy(true)
    try {
      await updateClass(cls.id, input)
      show('Class updated')
      await onChanged()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save those changes.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      <section className="rounded-panel border border-line p-4 sm:p-5">
        <h2 className="text-[15px]">Class details</h2>
        <p className="mt-1 text-[13px] text-muted">The join code never changes.</p>
        <div className="mt-4">
          <ClassForm
            formId="class-settings"
            defaults={cls}
            syllabi={syllabi}
            curricula={curricula}
            error={error}
            onSubmit={save}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button form="class-settings" type="submit" loading={busy} className="!rounded-xl">
            Save changes
          </Button>
        </div>
      </section>

      <section className="rounded-panel border border-line p-4 sm:p-5">
        <h2 className="text-[15px]">{cls.archived_at ? 'Restore class' : 'Archive class'}</h2>
        <p className="mt-1 text-[13px] text-muted">
          {cls.archived_at
            ? 'Students get the class back in their list, with its roster and announcements.'
            : 'Students lose access and it leaves their class list. The roster and announcements are kept.'}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={async () => {
            if (!cls.archived_at) return setArchivePrompt(true)
            try {
              await setArchived(cls.id, false)
              show('Class restored')
              await onChanged()
            } catch (err) {
              show(authErrorMessage(err, 'Could not restore the class.'), 'error')
            }
          }}
        >
          {cls.archived_at ? 'Restore class' : 'Archive class'}
        </Button>
      </section>

      {ownsClass && cls.archived_at && (
        <section className="rounded-panel border border-red-400/45 p-4 sm:p-5">
          <h2 className="text-[15px]">Delete class</h2>
          <p className="mt-1 text-[13px] text-muted">
            Permanently removes this class and everything in it.
          </p>
          <Button size="sm" variant="danger" className="mt-3" onClick={() => setDeletePrompt(true)}>
            Delete class
          </Button>
        </section>
      )}

      <ConfirmDialog
        open={archivePrompt}
        onClose={() => setArchivePrompt(false)}
        onConfirm={async () => {
          await setArchived(cls.id, true)
          show(`${cls.name} archived`)
          await onChanged()
        }}
        title={`Archive ${cls.name}?`}
        body="Students lose access immediately and it disappears from their class list. The roster and announcements are kept, and you can restore it any time."
        confirmLabel="Archive class"
      />

      <ConfirmDialog
        open={deletePrompt}
        onClose={() => setDeletePrompt(false)}
        onConfirm={async () => {
          await deleteClassPermanently(cls.id)
          show(`${cls.name} deleted`)
          navigate(paths.classes)
        }}
        title={`Delete ${cls.name} for good?`}
        body={
          <>
            Everything in this class is destroyed and cannot be recovered — the roster of{' '}
            <strong className="text-ink">
              {cls.student_count} {cls.student_count === 1 ? 'student' : 'students'}
            </strong>
            , every announcement, and <strong className="text-ink">every project in it</strong>{' '}
            with all of its groups' boards, tasks, comments and files.
            <br />
            <br />
            Archiving takes it out of everybody's way and keeps all of it.
          </>
        }
        confirmLabel="Delete permanently"
      />
    </div>
  )
}
```

If `Button` has no `outline` variant, use the variant `SpaceMembers.tsx` uses for its archive button (it uses `variant="outline"`, so it should exist).

- [ ] **Step 3: Build and test**

Run: `npm run build && npx vitest run`
Expected: the build succeeds and all tests pass. `ClassSettings` isn't rendered anywhere yet; Task 6 mounts it.

- [ ] **Step 4: Commit**

```bash
git add src/components/classes/ClassForm.tsx src/components/classes/ClassSettings.tsx
git commit -F - <<'EOF'
Move a class's edit, archive and delete into a settings panel

The form now keeps a class's current syllabus and curriculum choosable for a
co-teacher who doesn't own them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: The education space page

**Files:**
- Modify: `src/lib/classSpace.ts`, `src/lib/classSpace.test.ts` (append)
- Modify: `src/components/dashboard/TermStrip.tsx` (optional `hrefFor`)
- Create: `src/pages/app/classes/ClassSpace.tsx`
- Delete: `src/pages/app/classes/StudentClassDetail.tsx`, `src/pages/app/classes/ProfessorClassDetail.tsx`
- Modify: `src/App.tsx` (the `/classes/:classId` route and the two lazy imports)

**Interfaces:**
- Consumes: `Submissions`, `Analytics`, `Reports` with `classId` (Task 3); `FacultyPanel` (Task 4); `ClassSettings` (Task 5); `useGeneralNavigation().spaces` (each row has `id`, `my_level`).
- Produces: the pure functions below.
  - `type ClassTab = 'overview' | 'projects' | 'groups' | 'members' | 'syllabus' | 'submissions' | 'analytics' | 'reports' | 'settings'`
  - `teachesClass(viewer: { id: string; role: Role | null } | null, professorId: string, myLevel: GeneralLevel | null): boolean`
  - `classTabs(teaching: boolean): ClassTab[]`
  - `readClassTab(value: string | null, teaching: boolean): ClassTab`
- Produces: the tab is in the URL as `?tab=<ClassTab>`, and Overview drops the param. Anything may link to `` `${paths.class(id)}?tab=syllabus` ``.

- [ ] **Step 1: Write the failing tests** (append to `src/lib/classSpace.test.ts`)

Change the import line to `import { classTabs, readClassTab, teachesClass, teachingClassFilter } from './classSpace'`, then append:

```ts
describe('teachesClass', () => {
  const prof = { id: 'p1', role: 'professor' as const }

  it('is the class professor', () => {
    expect(teachesClass(prof, 'p1', null)).toBe(true)
  })

  it('is faculty holding Owner or Manager in the class space', () => {
    expect(teachesClass(prof, 'other', 'manager')).toBe(true)
    expect(teachesClass(prof, 'other', 'owner')).toBe(true)
    expect(teachesClass({ id: 'a1', role: 'admin' }, 'other', 'manager')).toBe(true)
  })

  it('is never a student, whatever the seat says', () => {
    expect(teachesClass({ id: 's1', role: 'student' }, 's1', 'owner')).toBe(false)
  })

  it('is not faculty without a teaching seat', () => {
    expect(teachesClass(prof, 'other', 'member')).toBe(false)
    expect(teachesClass(prof, 'other', null)).toBe(false)
    expect(teachesClass(null, 'p1', null)).toBe(false)
  })
})

describe('classTabs', () => {
  it('gives everyone the five shared tabs', () => {
    expect(classTabs(false)).toEqual(['overview', 'projects', 'groups', 'members', 'syllabus'])
  })

  it('adds the teaching tabs for faculty who teach it', () => {
    expect(classTabs(true)).toEqual([
      'overview', 'projects', 'groups', 'members', 'syllabus',
      'submissions', 'analytics', 'reports', 'settings',
    ])
  })
})

describe('readClassTab', () => {
  it('reads a tab the viewer has', () => {
    expect(readClassTab('groups', false)).toBe('groups')
    expect(readClassTab('settings', true)).toBe('settings')
  })

  it('falls back to Overview for no tab, an unknown one, or one the viewer lacks', () => {
    expect(readClassTab(null, true)).toBe('overview')
    expect(readClassTab('nope', true)).toBe('overview')
    expect(readClassTab('settings', false)).toBe('overview')
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/lib/classSpace.test.ts`
Expected: FAIL (`teachesClass` is not exported).

- [ ] **Step 3: Add the functions to `src/lib/classSpace.ts`**

Append the code below, with the `import type` lines at the top of the file:

```ts
import type { GeneralLevel } from './general/permissions'
import type { Role } from './types'

export type ClassTab =
  | 'overview'
  | 'projects'
  | 'groups'
  | 'members'
  | 'syllabus'
  | 'submissions'
  | 'analytics'
  | 'reports'
  | 'settings'

const SHARED: ClassTab[] = ['overview', 'projects', 'groups', 'members', 'syllabus']
const TEACHING: ClassTab[] = ['submissions', 'analytics', 'reports', 'settings']

/**
 * Whether this viewer teaches the class: its professor, or faculty holding
 * Owner or Manager in its space. The same rule as is_class_professor, so the
 * page never offers a tool the database would then refuse.
 */
export function teachesClass(
  viewer: { id: string; role: Role | null } | null,
  professorId: string,
  myLevel: GeneralLevel | null,
): boolean {
  if (!viewer || (viewer.role !== 'professor' && viewer.role !== 'admin')) return false
  return viewer.id === professorId || myLevel === 'owner' || myLevel === 'manager'
}

export function classTabs(teaching: boolean): ClassTab[] {
  return teaching ? [...SHARED, ...TEACHING] : SHARED
}

/** The `?tab=` value, if the viewer has that tab; Overview otherwise. */
export function readClassTab(value: string | null, teaching: boolean): ClassTab {
  const tabs = classTabs(teaching)
  return tabs.includes(value as ClassTab) ? (value as ClassTab) : 'overview'
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run src/lib/classSpace.test.ts`
Expected: PASS.

- [ ] **Step 5: `TermStrip` takes an optional link builder**

In `src/components/dashboard/TermStrip.tsx`, add `hrefFor?: (classId: string) => string` to the props, and change the link's `to`:

```tsx
to={hrefFor ? hrefFor(w.class_id) : `${linkBase}/${w.class_id}`}
```

- [ ] **Step 6: Write `src/pages/app/classes/ClassSpace.tsx`**

```tsx
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useLive } from '../../../hooks/useLive'
import { Alert } from '../../../components/ui/Alert'
import { Spinner } from '../../../components/ui/Icon'
import type { IconName } from '../../../components/ui/Icon'
import { Tabs } from '../../../components/ui/Tabs'
import { useToast } from '../../../components/ui/Toast'
import { AnnouncementFeed } from '../../../components/classes/AnnouncementFeed'
import { ClassAbout } from '../../../components/classes/ClassAbout'
import { ClassHeader } from '../../../components/classes/ClassHeader'
import { ClassSettings } from '../../../components/classes/ClassSettings'
import { FacultyPanel } from '../../../components/classes/FacultyPanel'
import { RosterTable } from '../../../components/classes/RosterTable'
import { TermStrip } from '../../../components/dashboard/TermStrip'
import { ClassGroupsTab } from '../../../components/groups/ClassGroupsTab'
import { ClassProjectsTab } from '../../../components/projects/ClassProjectsTab'
import { ClassSyllabusTab } from '../../../components/syllabus/ClassSyllabusTab'
import { useAuth } from '../../../context/AuthContext'
import { useGeneralNavigation } from '../../../context/generalNavigation'
import { listAnnouncements } from '../../../lib/api/announcements'
import { getClass, listMembers, removeMember, restoreMember, updateClass } from '../../../lib/api/classes'
import { currentWeekFor } from '../../../lib/api/dashboard'
import { authErrorMessage } from '../../../lib/authError'
import { classTabs, readClassTab, teachesClass } from '../../../lib/classSpace'
import type { ClassTab } from '../../../lib/classSpace'
import { paths } from '../../../lib/paths'
import type { Announcement, ClassMember, ClassSummary, ClassWeek } from '../../../lib/types'

// The faculty tabs pull in whole pages; students never load them.
const Submissions = lazy(() => import('../submissions/Submissions'))
const Analytics = lazy(() => import('../analytics/Analytics'))
const Reports = lazy(() => import('../reports/Reports'))

const TAB_META: Record<ClassTab, { label: string; icon: IconName }> = {
  overview: { label: 'Overview', icon: 'info' },
  projects: { label: 'Projects', icon: 'board' },
  groups: { label: 'Groups', icon: 'kanban' },
  members: { label: 'Members', icon: 'users' },
  syllabus: { label: 'Syllabus', icon: 'calendar' },
  submissions: { label: 'Submissions', icon: 'upload' },
  analytics: { label: 'Analytics', icon: 'chart' },
  reports: { label: 'Reports', icon: 'file' },
  settings: { label: 'Settings', icon: 'settings' },
}

/**
 * A class, opened as its education space. One page for everybody in it:
 * students get the shared tabs, and the faculty who teach it (its professor,
 * co-teachers and advisers) also get the teaching tabs. Which tab is open lives
 * in `?tab=`, so a link can open a class straight at its syllabus.
 */
export default function ClassSpace() {
  const { classId = '' } = useParams()
  const { profile } = useAuth()
  const { spaces } = useGeneralNavigation()
  const { show } = useToast()
  const [params, setParams] = useSearchParams()

  const [cls, setCls] = useState<ClassSummary | null>(null)
  const [members, setMembers] = useState<ClassMember[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [weeks, setWeeks] = useState<ClassWeek[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const student = profile?.role === 'student'

  const load = useCallback(async () => {
    if (!classId) return
    try {
      const [c, m, a, w] = await Promise.all([
        getClass(classId),
        listMembers(classId, !student),
        listAnnouncements(classId),
        currentWeekFor([classId]),
      ])
      setCls(c)
      setMembers(m)
      setAnnouncements(a)
      setWeeks(w)
      setError(
        c
          ? null
          : 'This class is no longer available. It may have been archived, or you are no longer in it.',
      )
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load that class.'))
    } finally {
      setLoading(false)
    }
  }, [classId, student])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['classes', 'class_members', 'projects', 'announcements', 'group_sets', 'groups', 'group_members', 'syllabus_weeks'])

  useEffect(() => {
    if (cls) document.title = `${cls.name} · Collabify`
  }, [cls])

  const myLevel = spaces?.find((s) => s.id === cls?.space_id)?.my_level ?? null
  const teaching = cls ? teachesClass(profile ?? null, cls.professor_id, myLevel) : false
  // A co-teacher's seat comes from the space list; until it arrives, don't
  // draw the student version of the page and then swap it.
  const seatKnown = student || spaces !== null || cls?.professor_id === profile?.id
  const tab = readClassTab(params.get('tab'), teaching)

  const setTab = (next: ClassTab) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        if (next === 'overview') out.delete('tab')
        else out.set('tab', next)
        return out
      },
      { replace: true },
    )

  if (loading || (cls && !seatKnown)) {
    return (
      <div className="flex items-center gap-3 py-16 text-[14px] text-muted">
        <Spinner size={16} />
        Loading class…
      </div>
    )
  }

  if (!cls) {
    return (
      <div className="mx-auto w-full max-w-[560px] py-10">
        <Alert tone="error">{error ?? 'That class could not be loaded.'}</Alert>
      </div>
    )
  }

  const active = members.filter((m) => m.status === 'active')
  const removedCount = members.filter((m) => m.status === 'removed').length
  const canManage = teaching && !cls.archived_at

  const tabs = classTabs(teaching).map((id) => ({
    id,
    icon: TAB_META[id].icon,
    label:
      id === 'members' && teaching && removedCount
        ? `Members · ${removedCount} removed`
        : TAB_META[id].label,
    count:
      id === 'overview' ? announcements.length : id === 'members' ? active.length : undefined,
  }))

  const pageLoading = (
    <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
      <Spinner size={16} />
      Loading…
    </div>
  )

  return (
    <div className="w-full">
      <ClassHeader
        cls={cls}
        backTo={paths.classes}
        canManage={teaching}
        onToggleJoin={
          teaching
            ? async (open) => {
                try {
                  await updateClass(classId, { join_open: open })
                  setCls({ ...cls, join_open: open })
                  show(open ? 'Students can join again' : 'Joining closed')
                } catch (err) {
                  show(authErrorMessage(err, 'Could not change that.'), 'error')
                }
              }
            : undefined
        }
      />

      <div className="mt-6">
        <Tabs<ClassTab> tabs={tabs} active={tab} onChange={setTab} variant="panel" />
      </div>

      <div className="mx-auto mt-6 w-full max-w-[1280px]">
        {tab === 'overview' && (
          <div className="space-y-6">
            {weeks.length > 0 && (
              <TermStrip
                weeks={weeks}
                classes={[cls]}
                linkBase={paths.classes}
                hrefFor={(id) => `${paths.class(id)}?tab=syllabus`}
              />
            )}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0">
                {profile && (
                  <AnnouncementFeed
                    classId={classId}
                    authorId={profile.id}
                    announcements={announcements}
                    canManage={canManage}
                    onChanged={load}
                  />
                )}
              </div>
              <aside className="min-w-0">
                <ClassAbout cls={cls} />
              </aside>
            </div>
          </div>
        )}

        {tab === 'projects' && (
          <ClassProjectsTab
            cls={cls}
            role={teaching ? 'professor' : 'student'}
            viewerId={profile?.id}
          />
        )}

        {tab === 'groups' &&
          (teaching ? (
            <ClassGroupsTab cls={cls} role="professor" />
          ) : (
            <ClassGroupsTab cls={cls} role="student" viewerId={profile?.id} />
          ))}

        {tab === 'members' && (
          <div className="space-y-6">
            <FacultyPanel cls={cls} />
            <section className="space-y-3">
              <h2 className="text-[15px]">Students</h2>
              {teaching ? (
                <RosterTable
                  members={members}
                  canManage={canManage}
                  canMessage
                  classId={classId}
                  onRecovered={load}
                  showEmail
                  emptyBody={`Share the code ${cls.code} with your section. Students join themselves — you never add them by hand.`}
                  onRemove={async (m) => {
                    if (!profile) return
                    await removeMember(classId, m.student_id, profile.id)
                    await load()
                  }}
                  onRestore={async (m) => {
                    const res = await restoreMember(classId, m.student_id)
                    await load()
                    return res
                  }}
                />
              ) : (
                <RosterTable
                  members={members}
                  canManage={false}
                  showEmail={false}
                  emptyBody="You're the first one here. Others show up as they join with the code."
                />
              )}
            </section>
          </div>
        )}

        {tab === 'syllabus' &&
          (teaching ? (
            <ClassSyllabusTab cls={cls} role="professor" onClassChanged={load} />
          ) : (
            <ClassSyllabusTab cls={cls} role="student" />
          ))}

        {tab === 'submissions' && (
          <Suspense fallback={pageLoading}>
            <Submissions classId={classId} />
          </Suspense>
        )}
        {tab === 'analytics' && (
          <Suspense fallback={pageLoading}>
            <Analytics classId={classId} />
          </Suspense>
        )}
        {tab === 'reports' && (
          <Suspense fallback={pageLoading}>
            <Reports classId={classId} />
          </Suspense>
        )}
        {tab === 'settings' && <ClassSettings cls={cls} onChanged={load} />}
      </div>
    </div>
  )
}
```

The old professor page passed `canManage={!cls.archived_at}` to the feed and roster, and the student page passed `canManage={false}`. `canManage` above is exactly that per role. Check that each component's props match what the two old pages passed (they're copied from there). If `Tabs`' tab type has no optional `count`, drop `count: undefined` entries by building the object conditionally.

- [ ] **Step 7: Route it and delete the old pages**

In `src/App.tsx`:

- Remove the `ProfessorClassDetail` and `StudentClassDetail` lazy imports.
- Add `const ClassSpace = lazy(() => import('./pages/app/classes/ClassSpace'))` beside the other class-page imports.
- Change the route to:

```tsx
              <Route
                path="/classes/:classId"
                element={<RoleSwitch student={<ClassSpace />} professor={<ClassSpace />} />}
              />
```

Then run `git rm src/pages/app/classes/StudentClassDetail.tsx src/pages/app/classes/ProfessorClassDetail.tsx`, and check nothing else imports them: `grep -rn "ClassDetail'" src` should print nothing.

- [ ] **Step 8: Build and test**

Run: `npm run build && npx vitest run`
Expected: the build succeeds and all tests pass. Also run the link grep:
`grep -rnoE "['\"\`]/(student|professor|general)(/|['\"\`])" src --include=*.ts --include=*.tsx | grep -v "src/lib/paths"`
Expected: only the `App.tsx` legacy mounts, as before.

- [ ] **Step 9: Commit**

```bash
git add src/lib/classSpace.ts src/lib/classSpace.test.ts src/components/dashboard/TermStrip.tsx src/pages/app/classes/ClassSpace.tsx src/App.tsx
git commit -F - <<'EOF'
Open a class as its education space

One page for everyone in the class, with the tab in the URL. Students get
Overview, Projects, Groups, Members and Syllabus; the faculty who teach it
also get Submissions, Analytics, Reports and Settings, each narrowed to this
class. Replaces the separate student and professor class pages.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: New space asks Education or Work

**Files:**
- Modify: `src/components/general/SpaceDialogs.tsx` (`NewSpaceDialog`)
- Modify: `src/pages/app/classes/ProfessorClasses.tsx`

**Interfaces:**
- Produces: `NewSpaceDialog({ open, onClose, onCreated?, initialKind? }: { …; initialKind?: 'education' | 'work' })`.
  - Teaching faculty (`canTeach(profile)`) first choose the kind, unless `initialKind` is set.
  - Everyone else gets the work form directly, as today.
  - Education creates a class (which makes its space, per phase 2) and opens it.
  - Work creates a work space and opens it, as today.
- Callers:
  - `SpacePicker` and `WorkOverview` keep calling it without `initialKind`.
  - `ProfessorClasses` calls it with `initialKind="education"`.

- [ ] **Step 1: Rewrite `NewSpaceDialog`**

In `src/components/general/SpaceDialogs.tsx`, replace `NewSpaceDialog` with the code below. Keep `JoinSpaceDialog` and `EditSpaceDialog` as they are, and add these imports:

```ts
import { useEffect } from 'react'  // merge into the existing 'react' import
import { useAuth } from '../../context/AuthContext'
import { canTeach } from '../../lib/access'
import { createClass } from '../../lib/api/classes'
import type { ClassInput } from '../../lib/api/classes'
import { listResources } from '../../lib/api/resources'
import type { TeachingResource } from '../../lib/types'
import { ClassForm } from '../classes/ClassForm'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useToast } from '../ui/Toast'
```

```tsx
type SpaceKind = 'education' | 'work'

export function NewSpaceDialog({
  open,
  onClose,
  onCreated,
  initialKind,
}: {
  open: boolean
  onClose: () => void
  onCreated?: () => void | Promise<void>
  /** Skip the choice and open straight at this kind. */
  initialKind?: SpaceKind
}) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { show } = useToast()
  const teaching = canTeach(profile)
  // Only faculty who teach choose; everyone else can only make a work space.
  const startKind: SpaceKind | null = teaching ? (initialKind ?? null) : 'work'
  const choosing = teaching && !initialKind

  const [kind, setKind] = useState<SpaceKind | null>(startKind)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [syllabi, setSyllabi] = useState<TeachingResource[]>([])
  const [curricula, setCurricula] = useState<TeachingResource[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKind(startKind)
    setError(null)
  }, [open, startKind])

  useEffect(() => {
    if (!open || kind !== 'education' || !profile) return
    void Promise.all([listResources(profile.id, 'syllabus'), listResources(profile.id, 'curriculum')])
      .then(([s, c]) => {
        setSyllabi(s)
        setCurricula(c)
      })
      .catch(() => {
        // The dropdowns simply stay empty; making the class does not depend on them.
      })
  }, [open, kind, profile])

  async function createWork(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const space = await createSpace(name, description)
      rememberSpace(space.id)
      await onCreated?.()
      onClose()
      setName('')
      setDescription('')
      navigate(paths.space(space.id))
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create that space.'))
    } finally {
      setBusy(false)
    }
  }

  async function createEducation(input: ClassInput) {
    if (!profile) return
    setError(null)
    setBusy(true)
    try {
      const created = await createClass(profile.id, input)
      show(`${created.name} created · code ${created.code}`)
      await onCreated?.()
      onClose()
      navigate(paths.class(created.id))
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create that class.'))
    } finally {
      setBusy(false)
    }
  }

  const back = choosing ? (
    <Button variant="ghost" onClick={() => setKind(null)} disabled={busy}>
      Back
    </Button>
  ) : null

  if (kind === null) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Create space"
        description="Choose what the space is for. A space keeps its kind."
        size="sm"
        footer={
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        }
      >
        <div className="grid gap-3">
          <KindOption
            icon="folder"
            tone="education"
            title="Education"
            body="A class. Students join with its code, and it has syllabus weeks, groups, projects and grading."
            onPick={() => setKind('education')}
          />
          <KindOption
            icon="kanban"
            tone="work"
            title="Work"
            body="Projects, teams and reports for anything that isn't a class."
            onPick={() => setKind('work')}
          />
        </div>
      </Modal>
    )
  }

  if (kind === 'education') {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Create class"
        description="Students join with its code. You can change everything here later in its settings."
        size="lg"
        footer={
          <>
            {back}
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button form="new-class" type="submit" loading={busy} className="!rounded-xl">
              Create class
            </Button>
          </>
        }
      >
        <ClassForm
          formId="new-class"
          syllabi={syllabi}
          curricula={curricula}
          error={error}
          onSubmit={createEducation}
        />
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create space"
      description="A space holds projects. Everyone you add to it can see every project inside."
      size="sm"
      focusField
      footer={
        <>
          {back}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-general-space"
            loading={busy}
            disabled={name.trim().length === 0}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="new-general-space" onSubmit={createWork} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={80}
              placeholder="Student council"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Description" hint="Optional. What the space is for.">
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={400}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}

/** One kind of space to pick, badged the way the sidebar badges it. */
function KindOption({
  icon,
  tone,
  title,
  body,
  onPick,
}: {
  icon: IconName
  tone: SpaceKind
  title: string
  body: string
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-start gap-3 rounded-card border border-line p-4 text-left transition-colors hover:border-line-strong"
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-lg ${
          tone === 'education'
            ? 'bg-amber-400/18 text-amber-700 dark:text-amber-300'
            : 'surface-sunken text-muted'
        }`}
      >
        <Icon name={icon} size={17} />
      </span>
      <span>
        <span className="block text-[14px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] text-muted">{body}</span>
      </span>
    </button>
  )
}
```

- [ ] **Step 2: "Create class" opens it at Education**

In `src/pages/app/classes/ProfessorClasses.tsx`:

- Delete:
  - the `syllabi`/`curricula`/`busy`/`formError` state;
  - the resources `useEffect`;
  - `submit`;
  - the create `<Modal>…</Modal>` with its `ClassForm`.
- Keep `createOpen`/`setCreateOpen` and the three "Create class" buttons.
- Render the dialog instead:

```tsx
      <NewSpaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        initialKind="education"
        onCreated={async () => {
          setView('active')
          await load()
        }}
      />
```

Import `NewSpaceDialog` from `'../../../components/general/SpaceDialogs'`, and remove the imports that are now unused (`Modal`, `ClassForm`, `createClass`, `ClassInput`, `listResources`, `TeachingResource`, and `useToast`/`show` if nothing else uses them). `tsc -b` reports each one.

- [ ] **Step 3: Build and test**

Run: `npm run build && npx vitest run`
Expected: the build succeeds and all tests pass. Also check `grep -n "createClass(" src -r` prints only `src/components/general/SpaceDialogs.tsx` and `src/lib/api/classes.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/components/general/SpaceDialogs.tsx src/pages/app/classes/ProfessorClasses.tsx
git commit -F - <<'EOF'
Ask Education or Work when faculty create a space

Faculty who teach choose the kind first; Education opens the class form and
takes them into the new class. Everyone else gets the work form as before.
Create class on the Classes page opens the same dialog at Education.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Verify, hand off, and walk it (controller + owner)

**Files:**
- Modify: `handoff.md` (append a section at the end)

- [ ] **Step 1: Full checks**

Run: `npm run build`, then `npx vitest run`, then every SQL suite (`for f in supabase/tests/*.test.sql; do node scripts/db.mjs "$f" 2>&1 | grep -E "FAIL|ERROR" && echo "in $f"; done`), then `node scripts/schema-drift.mjs` if it runs without secrets being printed.
Expected: the build succeeds, all vitest tests pass, no SQL failures.

- [ ] **Step 2: Final whole-branch review**

Dispatch the final reviewer over `git merge-base` (the commit before Task 1) to HEAD, per subagent-driven-development. Fix the findings in one fix round, then push.

- [ ] **Step 3: Append to `handoff.md`**

One section covering phase 3a and 3b:
- what shipped, and the commit range;
- the deferred items (listed in the ledger: create_general_project kind fallback, deactivated professors via professor_id, restore past the cap, space description drift, project_boards_write self-reference, general-space-teams rebuild line, month-view chip styling, useConversations triple subscription, gate.test matrix gaps, space-level student positions);
- the open owner question (admin without Can teach and "New message");
- what's next: phase 4 cleanup.

Commit it and push.

- [ ] **Step 4: Owner browser walk (3a + 3b together)**

The owner signs in; the controller never does. Per role:

**Student**
- The rail reads MAIN, YOUR SPACES (amber class badges), YOUR PROJECTS, CLASSES (with Your record), ACCOUNT.
- Home is stacked.
- My tasks, Calendar and Messages have the All · Classes · Work filter, and it survives opening an item.
- `/student/classes` lands on `/classes`.
- A class opens with Overview, Projects, Groups, Members and Syllabus. Overview shows this week and the announcements. Members lists the Faculty, then the Students.
- There's no Settings tab, and `?tab=settings` shows Overview.

**Professor (teaching)**
- The TEACHING group is there, and `/professor/submissions` redirects.
- A class shows all nine tabs. Submissions, Analytics and Reports show only that class, with no class picker. Settings saves an edit, and archive and restore work.
- Members → Invite faculty finds only faculty. Inviting the second faculty account works; they accept from Spaces → Invitations and the class opens for them with the teaching tabs.
- The co-teacher sees the class under Classes and in the class chat in Messages, but has no Delete in Settings.
- New space (Spaces page) asks Education or Work. Each creates and opens the right thing.

**Admin**
- The ADMIN group is there, `/admin` goes to Home, and Faculty approvals works.

After the walk, the controller removes any test class or space the owner made, if asked, and records the walk in the ledger.
