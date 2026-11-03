# AI-assisted project member setup — design

Status: draft for owner review, 2026-11-03. No product code is authorized by this document.

## Intent

In a work project's Settings → Members & permissions, the project manager or a coordinator uploads a roster in Word, Excel, or PDF form. The assistant reads it and proposes each listed member's project teams, positions within those teams, and skill tags. The user checks the proposal and applies it. This replaces repetitive manual setup without letting an uncertain name or AI guess change project data.

## Agreed behavior

- The roster may refer only to people already in this project. If a name does not match a member, mark it and stop before showing an assignment draft. Tell the user to remove the name from the file or invite the person to the project first, then upload again. The import never invites people.
- If a name matches more than one project member, the user chooses the intended member. Never choose one automatically.
- Offer **Add** and **Replace** for the listed members. Add keeps their current teams, positions, and skills and adds the file's values. Replace sets each nonblank field to the file's values. A blank field leaves that field unchanged, including in Replace mode. Members absent from the file are untouched.
- Propose creating teams and team-scoped positions named in the file when they do not exist. Reuse matching existing teams and positions; do not rename or remove them.
- Team leader, project roles, grants, invitations, and task assignments are outside this import. A position named “Team lead” does not set the separate functional team leader.

## Guided flow

1. A **Set up members from file** action in Members & permissions opens a dialog for `.docx`, `.xlsx`, or `.pdf`. State the file size limit and that its contents will be processed by the project's AI service. Keep the file temporary; do not save it to project files.
2. Read the file using existing readers (`src/lib/general/notesFile.ts` and `office.ts`), preserving Excel sheet and row context. Send the extracted content to a new `work-ai` action. The model returns structured source rows: name, team names, team-scoped position names, and skill names, with source location and a blank value for anything the file did not say. It must not invent entries. For a PDF without extractable text, send the PDF to the existing model document reader so scanned pages can be read. Reject an unreadable file; never silently truncate a roster and omit members.
3. Match names against the current project roster using stable member IDs. Match unambiguous names; show unmatched names and require user selection for duplicate names. Do not present an assignment draft until all names resolve to current members. After an invitation, refresh membership and require the file to be uploaded again. Combine repeated rows for the same person when they list additional teams, positions, or skills; flag contradictory rows for correction.
4. Choose Add or Replace. Show a review grouped by member: current values, proposed values, creations, additions, and removals. The user can exclude an entire member from this import. A team-scoped position requires membership in that team; the proposal adds that team automatically. Missing positions are created in the team named by the file. A position with no team context is project-wide only when the file clearly says so; otherwise flag it for correction.
5. Validate the whole proposal before enabling **Apply**. Flag unsupported skill targets (QA or stakeholder), tags above existing limits, missing fields needed to place a position, ambiguity, or inconsistent team/position combinations. When Replace would remove a team needed by an unchanged position, stop and ask for a corrected file or a choice in review; do not silently break the relationship.
6. On Apply, refresh the project data and require another review if any affected member's current structure changed since the preview. Apply the approved changes in one database transaction. If a permission, membership, archive, limit, or database check fails, change nothing and show a recoverable error. Reload the project state after success.

## Implementation boundaries

- This is for active work projects. Show the action only to their project manager and coordinators. The `work-ai` action and the apply RPC independently check the caller's current project role and project state. Existing row security and database constraints remain in force; no service-role client writes.
- Extend the existing `work-ai` function for structured extraction. It only returns data. The AI never calls a write tool. Reuse the installed document readers and `general_teams`, `general_team_members`, `general_positions`, `general_position_holders`, and `general_member_skills` data already loaded by `useGeneralProject`.
- The apply RPC validates member IDs, project ownership of teams and positions, role and tag rules, reasonable batch limits, and Add/Replace semantics itself. It runs atomically and is idempotent for retries. Keep the SQL file idempotent and in the documented restore order; rerun `anon-lockdown.sql` last.
- Document content is untrusted data. Ignore instructions inside it, return only the roster schema, and validate the result against the live project roster before any write. Do not retain the uploaded file or its text after the dialog closes.
- Initial supported files are modern Word (`.docx`), Excel (`.xlsx`), and PDF, including scanned PDFs. Legacy `.doc` and `.xls` receive a clear unsupported-file message unless the existing readers can safely handle them during implementation. Normal text PDFs use local text extraction; scanned PDFs use the existing model document reader, with a clear error if it cannot read them.

## Checks

- A real `.docx`, `.xlsx` with multiple sheets, text PDF, and scanned PDF produce the expected rows and source locations. An unreadable or over-limit file is refused before a partial roster can be applied.
- Unknown and duplicate names cannot reach Apply. A person added to the project between upload and retry must be resolved against a fresh roster.
- Add, Replace, blank fields, new teams and positions, project-wide versus team positions, excluded members, and unchanged members yield the shown result. Existing team leaders, roles, grants, and task assignments do not change.
- SQL checks cover unauthorized callers, class-board and archived projects, stale membership, tag limits and unsupported roles, cross-project IDs, transaction rollback, and retry behavior. Run the relevant SQL suites, Vitest, and `npm run build`.

## Approaches considered

- **Guided import — chosen.** File → identify people → resolve blockers → choose Add or Replace → review → atomic Apply. It makes every change visible before writing and fits the existing project settings.
- **Conversational assistant.** File → chat to refine instructions → review → Apply. It offers more free-form control but makes the final set of changes harder to inspect and adds interaction the current task does not require.

## Builder decisions left

Choose concrete upload and batch limits and the exact dialog layout within the existing design system. Preserve the agreed behavior above.
