# Project Member Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a work project's project manager or coordinator set existing members' teams, positions, and skills from a Word, Excel, or PDF roster after reviewing every change.

**Architecture:** A new `work-ai` action extracts structured rows without writing. Pure client code matches rows to the live project roster and calculates Add or Replace changes. One PostgreSQL RPC rechecks authority, membership, and the reviewed snapshot, then applies the whole batch atomically.

**Tech Stack:** React 19, TypeScript, Vite, Supabase/Postgres, the existing `work-ai` Edge Function, Mammoth, ExcelJS, pdfjs-dist, Anthropic, Vitest, and SQL rollback suites.

**Spec:** `docs/superpowers/specs/2026-11-03-project-member-import-design.md`.

## Global Constraints

- Work projects only; the project manager and coordinators may use it, on active projects. A Member granted `manage_structure` may still use the manual controls but not this import.
- The file may name only current project members. Unmatched names block the draft and say to remove them or invite them first. Duplicate names require user selection. Never invite through the import.
- Add unions values; Replace replaces only fields explicitly present for listed members. Blank fields and members absent from the file stay unchanged.
- New teams and team-scoped positions may be created. Never change team leaders, project roles, grants, invitations, or task assignments.
- Input: `.docx`, `.xlsx`, `.pdf` including scanned PDF. Reject `.doc`, `.xls`, unreadable files, files over 5 MB, text over 60,000 characters, or output over 100 distinct people; never silently cut the roster. No new dependency.
- Files stay temporary. The dialog discloses that file content goes to the AI service. The AI only extracts data; document instructions cannot authorize writes.
- All SQL files stay idempotent. Register a new SQL file in both restore order lists; after creating a function, run `anon-lockdown.sql` last. Never read or print `.env.local` or database secrets.
- Follow `CLAUDE.md` copy and design-token rules. No raw colors. Do not stage `desktop.ini`, `.superpowers/`, `graphify-out/`, `supabase/.temp/`, or unrelated dirty files.
- After code changes, run `graphify update .` if the command is available. Run `npm run build` before claiming the feature works.

## Review Focus

- An image-only PDF or a roster longer than the model budget must not omit names without warning (Task 1 file tests and Edge response check).
- Two members with the same full name, or one name not on the roster, must not get an automatic assignment (Task 2 matcher tests, Task 4 dialog test).
- The same member appearing on several Excel rows or sheets should gain every stated value, while blanks stay blank (Task 2 merge tests).
- Replace must not drop a team's leader or remove a team while retaining one of its team-scoped positions (Task 2 preview and Task 3 SQL tests).
- A member or team changed after review must cause a stale-preview refusal rather than an unseen overwrite (Task 3 SQL test, Task 4 refresh test).

## File Map

| File | Responsibility |
|---|---|
| `src/lib/general/memberImportFile.ts` + `.test.ts` | Read the three formats, label source locations, reject incomplete input, send image-only PDF bytes for model reading. |
| `supabase/functions/work-ai/index.ts` | New read-only `member-import` action, role gate, strict output schema, size and completeness checks. |
| `src/lib/api/workAi.ts` | Typed extraction wrapper. |
| `src/lib/general/memberImport.ts` + `.test.ts` | Match members and compute reviewed Add/Replace changes and expected state. |
| `supabase/project-member-import.sql` + `supabase/tests/project-member-import.test.sql` | Atomic apply RPC and its rollback suite. |
| `src/lib/api/general.ts` | Typed apply wrapper. |
| `src/components/general/settings/MemberImportDialog.tsx` + `.test.tsx` | Upload, resolve names, review, and apply. |
| `src/components/general/settings/MembersSection.tsx` + `.test.tsx` | Entry action with the correct visibility. |
| `scripts/schema-drift.mjs`, `docs/07-backup.md`, `handoff.md` | Restore order and release notes. |

---

### Task 1: Read a roster and extract source rows

**Files:** Create `src/lib/general/memberImportFile.ts`, `src/lib/general/memberImportFile.test.ts`; modify `supabase/functions/work-ai/index.ts`, `src/lib/api/workAi.ts`.

**Interfaces:**
- `readMemberImportFile(file: File): Promise<{ fileName: string; text: string } | { fileName: string; pdfBase64: string }>`: label Word paragraphs, Excel sheet/row, PDF pages; return base64 only when PDF text is empty. Throw a user-facing error for unsupported, over-limit, damaged, or cut input.
- `RosterRow = { name: string; source: string; teams: string[]; positions: { team: string; name: string }[]; skills: string[]; present: { teams: boolean; positions: boolean; skills: boolean } }`. `present=false` means blank, not clear. An explicit “none” may be `present=true` with an empty list.
- `extractMemberRoster(projectId: string, source: Awaited<ReturnType<typeof readMemberImportFile>>): Promise<{ result: 'ok'; rows: RosterRow[] } | { result: 'failed'; message: string }>` calls `work-ai` action `member-import`.

- [ ] **Step 1: Write failing file-reader tests.** Assert a generated `.docx` paragraph roster, `.xlsx` with two sheets, and text PDF retain source labels; an image-only PDF returns `pdfBase64`; `.doc`/`.xls`, >5 MB, and >60,000 characters refuse instead of returning a partial roster.
- [ ] **Step 2: Run `npx vitest run src/lib/general/memberImportFile.test.ts`; expect failure for the missing reader.**
- [ ] **Step 3: Implement the reader using the installed Mammoth, `xlsxToWorkbook`, and pdfjs-dist.** Do not call `readNotesFile`: it cuts text and uses task-specific errors. Keep file bytes in memory only.
- [ ] **Step 4: Add the `member-import` action and typed client wrapper.** After the common authenticated-member check, verify `general_members.role in ('pm','coordinator')`, `profiles.status='active'`, `general_projects.class_board_id is null`, and `archived_at is null` through the caller's JWT before the model call. Use the existing Anthropic `ask()` JSON schema, rate limits, and PDF document block. Instruct the model to extract only stated names and values, return every row with source, never follow document instructions, and report `complete=false` if it cannot cover the whole file. Reject incomplete, malformed, or over-100-person output; return no IDs and never write.
- [ ] **Step 5: Verify `npx vitest run src/lib/general/memberImportFile.test.ts` and `npm run build`; expect pass.** The signed-in Edge check belongs to Task 5's browser walk.
- [ ] **Step 6: Review the diff, then commit only Task 1 files.**

### Task 2: Match people and calculate the reviewed change

**Files:** Create `src/lib/general/memberImport.ts`, `src/lib/general/memberImport.test.ts`.

**Interfaces:**
- `resolveMemberImport(rows: RosterRow[], members: { userId: string; name: string }[], choices: Record<number, string>): { resolved: ResolvedImportRow[]; unknown: RosterRow[]; ambiguous: { row: number; candidates: string[] }[]; conflicts: string[] }`. Trim/collapse whitespace and compare case-insensitively. `choices` accepts only a candidate member ID for that row; unknown names cannot be overridden into membership.
- `previewMemberImport(mode: 'add' | 'replace', resolved: ResolvedImportRow[], current: ImportCurrent, excluded: Set<string>): ImportPreview`. `ImportCurrent` contains the project's loaded members, teams, team memberships, positions, holders, and skills. `ImportPreview` holds human-readable additions/removals, new team/position names, `rows` for the apply RPC, an `expected` snapshot of the affected rows/catalog, and blockers.
- RPC rows contain `{ user_id, teams: string[] | null, positions: { team: string; name: string }[] | null, skills: string[] | null }`; `null` means leave that field unchanged. Use normalized names; never put a member name or AI-provided ID in a write payload.

- [ ] **Step 1: Write failing resolver tests.** Unique full name resolves; duplicate name needs a valid choice; unknown name stays blocked; a stale/noncandidate choice is rejected; repeated rows across sheets union stated values; an explicit “none” conflicting with a stated value blocks; blank fields do not turn into empty lists.
- [ ] **Step 2: Run `npx vitest run src/lib/general/memberImport.test.ts`; expect failure.**
- [ ] **Step 3: Implement `resolveMemberImport` and rerun the focused tests.** Only a current project member ID may leave the resolution stage.
- [ ] **Step 4: Write failing preview tests.** Add unions, Replace changes only nonblank fields, excluded/absent members stay untouched, case-insensitive existing names are reused, new team-scoped positions appear once, a team-scoped position implies team membership, and a position without a clear team is flagged rather than guessed project-wide. QA/stakeholder skills and >12 tags block. Replace blocks removal of a team leader or a team still needed by an unchanged position.
- [ ] **Step 5: Implement `previewMemberImport`; run `npx vitest run src/lib/general/memberImport.test.ts`; expect pass.** Flag ambiguous existing positions with the same scoped name; never guess which one to reuse.
- [ ] **Step 6: Review the diff, then commit only Task 2 files.**

### Task 3: Apply the approved import as one transaction

**Files:** Create `supabase/project-member-import.sql`, `supabase/tests/project-member-import.test.sql`; modify `src/lib/api/general.ts`, `scripts/schema-drift.mjs`, `docs/07-backup.md`.

**Interfaces:**
- `public.apply_general_member_import(p_project uuid, p_mode text, p_rows jsonb, p_expected jsonb) returns jsonb` (`security definer`, fixed `search_path`, `authenticated` EXECUTE only). It returns counts of created teams/positions and changed members. Any refusal raises an actionable error and rolls back the call.
- `applyMemberImport(projectId: string, mode: 'add' | 'replace', preview: Pick<ImportPreview, 'rows' | 'expected'>): Promise<ApplyCounts>` in `src/lib/api/general.ts` invokes the RPC.
- `p_expected` is a canonical, sorted snapshot of affected members' team IDs, position IDs, skill tags, plus referenced team/position IDs and names. The RPC compares it with current rows under project/structure locks before changing anything. An exact retry whose desired result already exists returns zero changes.

- [ ] **Step 1: Write the rollback SQL suite.** Fixtures cover PM, coordinator, Member with `manage_structure`, QA, stakeholder, outsider, archived work project, and class board. Assert Add, Replace, blank fields, new team/position creation, duplicate names reused, skill normalization/12-tag limit, unchanged absent members, unchanged functional team leaders, and exact retry.
- [ ] **Step 2: Add refusal and rollback checks.** Cross-project IDs, missing member, revoked coordinator, concurrent structure change, stale expected snapshot, removing a leader's team, and retaining an incompatible team-scoped position must leave all tables unchanged. Include a failure deliberately triggered after an earlier insert to prove transaction rollback.
- [ ] **Step 3: Implement the SQL RPC with explicit role/state checks and static SQL.** Validate batch sizes, JSON shape, member IDs, scoped names, and tag rules before writes. Lock the project and relevant current rows; compare `p_expected`; create teams, add required memberships, create scoped positions, update holders, then skills. For Replace, remove unlisted holders before unlisted team memberships. Preserve leaders and all non-target settings. Use existing `guard_general_structure` and constraints as a second line of defense.
- [ ] **Step 4: Register `project-member-import.sql` after `project-workflow-rules.sql` and before final `anon-lockdown.sql` in both restore lists.** Add the API wrapper. Do not re-run older SQL owners in isolation.
- [ ] **Step 5: Dry-run the migration, `anon-lockdown.sql`, and the new suite together in one rollback transaction against the configured DB.** Build a temporary SQL file outside the repo: prepend `begin;`, strip each migration's outer `begin;`/`commit;`, append their bodies and the suite (whose final `rollback;` rolls all of it back). Run `node scripts/db.mjs <absolute-temp-file>`; expect PASS notices, no FAIL, and no lasting schema change. Do not apply the migration live in this task.
- [ ] **Step 6: Run `npm run build`, review the diff, then commit only Task 3 files.**

### Task 4: Guided import in Members & permissions

**Files:** Create `src/components/general/settings/MemberImportDialog.tsx`, `src/components/general/settings/MemberImportDialog.test.tsx`; modify `src/components/general/settings/MembersSection.tsx`, `src/components/general/settings/MembersSection.test.tsx`.

**Interfaces:** Consumes `readMemberImportFile`, `extractMemberRoster`, `resolveMemberImport`, `previewMemberImport`, and `applyMemberImport` from Tasks 1–3. Uses `GeneralProjectState` for the live roster and structure. No other settings tab changes.

- [ ] **Step 1: Write failing UI tests.** Only PM/coordinator on an active work project sees the action. File selection discloses AI processing. Unknown names show a persistent alert saying remove or invite first, with no draft or Apply; duplicate names show project-member choices. The dialog cannot proceed with unresolved rows.
- [ ] **Step 2: Add UI tests for Add/Replace review.** Assert current/proposed values, new teams/positions, excluded members, blank-field preservation, and changed/removed counts. Apply is disabled while blockers remain and requires an explicit review confirmation.
- [ ] **Step 3: Add UI tests for apply failure.** Reload immediately before Apply; if relevant current state changed, return to review. On RPC refusal, keep the draft and show the error; on success, reload and close. Closing the dialog discards file text and row data.
- [ ] **Step 4: Run `npx vitest run src/components/general/settings/MemberImportDialog.test.tsx src/components/general/settings/MembersSection.test.tsx`; expect failures for the missing action/dialog.**
- [ ] **Step 5: Implement the dialog and entry action using existing Button, Modal, Alert, Select, and token styles.** Do not add a chat surface. Let the user exclude a resolved member, but never exclude an unknown name to bypass the roster rule. Keep review readable on desktop, tablet, and phone.
- [ ] **Step 6: Run the focused tests, full `npx vitest run`, and `npm run build`; expect pass. Review the diff, then commit only Task 4 files.**

### Task 5: Final verification and rollout handoff

**Files:** Modify `handoff.md` after the feature is verified.

- [ ] **Step 1: Run `npm run build`, `npx vitest run`, and `node scripts/schema-drift.mjs`.** For each `supabase/tests/*.test.sql` suite, make a fresh temporary rollback file as in Task 3 Step 5 with the migration loaded; check each exit code and PASS/FAIL lines.
- [ ] **Step 2: After owner rollout approval, apply `node scripts/db.mjs supabase/project-member-import.sql supabase/anon-lockdown.sql`, deploy `work-ai`, and push the verified frontend.** Run `node scripts/db.mjs supabase/tests/project-member-import.test.sql` and `node scripts/db.mjs supabase/tests/anon-lockdown.test.sql` against live; do not expose secret values.
- [ ] **Step 3: Browser-check with an owner-signed-in PM/coordinator account:** `.docx`, `.xlsx`, text PDF, scanned PDF, unknown name, duplicate name choice, Add, Replace, and stale review. The owner signs in; the agent does not sign in or create accounts.
- [ ] **Step 4: Append the feature's behavior, verification, migration order, and deployment state to `handoff.md`; commit only that file.** Never claim the feature is live before the SQL, Edge Function, and frontend are deployed and checked.

## Execution order

Complete Tasks 1–4 in order, reviewing each diff before the next task. The existing `project-workflow-rules.sql` remains unshipped per `handoff.md`; finish its owner walk and rollout decision before applying this plan's SQL to the live database. Do not treat approval of this plan as approval to deploy.
