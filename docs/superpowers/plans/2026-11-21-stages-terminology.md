# Stages terminology — implementation plan

**Status:** Implemented and verified; deployed to the shared database and `work-ai` function. Frontend release follows the main-branch push.

**Goal:** Show the existing dated sprint cycles as **Stages** by default in work projects and educational boards. Each work project or class board can call them something else, such as **Phases**. Keep scheduling, start/finish, carryover, streams, automation, permissions, and saved links working as they do today.

## Decisions

- The change is to user-facing terminology, not the underlying cycle behavior. Database tables, API fields, function names, notification types, and query values such as `work=sprints` remain stable.
- Store a **singular and plural** name per work project or class board. Defaults: `Stage` and `Stages`. Example: `Phase` and `Phases`. This avoids incorrect grammar in buttons and notices.
- The work project's existing Settings → Sprints section becomes **Stage settings**, or **Phase settings** after customization. The class board gets a small naming control in its Plan area because it has no sprint settings page today.
- The project manager and Coordinators keep control of work project settings. On a group board, the group leader and teaching faculty can change only this label; students retain today's group planning rights. On an individual board, its student and teaching faculty can change it.
- Rename the existing task-column concept from “progress stages” to **task workflow steps** in the UI. Its saved columns and task behavior stay unchanged. “Stage” then means a dated work cycle in the project UI.
- Changing the label never renames a saved cycle, whether planned, running, finished, or archived. For example, after finishing “Sprint 1” and “Sprint 2,” changing the label to Phases leaves those history entries as “Sprint 1” and “Sprint 2”; the next automatically named cycle is “Phase 3.” This applies to work projects and class boards.
- New notifications and generated content use the term in effect when created. Previously stored notification text and exported documents stay as historical records. Cross-project or cross-board summaries with different terms use a neutral heading and identify each board's term.

## Implementation

### 1. Persist the label and enforce who may edit it

- Add `term_singular` and `term_plural` to `general_sprint_settings` and `project_boards`, with bounded, trimmed values and `Stage`/`Stages` defaults. Work projects without a settings row read the defaults.
- Extend the existing work settings read/save API. Add a class-board read and a narrow `set_board_stage_terms` RPC that checks the current group leader, individual board owner, or a teacher of the class. Do not broaden permission to edit the board or its cycles.
- Keep archived or closed projects read-only. Test authorized and refused writes, a leader handover, an individual board, and a teacher who is not a board member.
- Put the idempotent SQL in a new file after the current final schema owners and before `anon-lockdown.sql`. Register it in `scripts/schema-drift.mjs` and `docs/07-backup.md`.

### 2. Make one terminology helper and update settings

- Add a small shared formatter for singular, plural, title case, and lower case. Read the label from the active work project or board; do not copy strings into every component.
- Rename work Settings → Sprints and its heading, controls, help, confirmation, and save feedback. Keep the `section=sprints` URL so bookmarks work.
- Add singular/plural name fields on the educational board's Plan tab. Show the saved name to everyone; show Edit only to the authorized people. Keep teachers' planning controls read-only.
- Rename task-column headings and controls to **Task workflow steps** in project creation, Tasks settings, Overview, and task editing so they remain distinct from dated Stages.

### 3. Apply the term across work and class views

- Pass the active term through the shared work source into Backlog, the cycle view, dialogs, filters, timeline, calendar, milestones, archive, progress cards, and task empty states.
- Replace user-facing “Sprint/Sprints” with the scoped name, including create/start/finish/reopen actions, errors, accessible labels, tooltips, and mobile layouts. Keep internal TypeScript names and database columns unchanged.
- Use the default Stage/Stages in global views with no single project context. For combined class reports where boards choose different terms, use a neutral section title and the corresponding board label within each section.

### 4. Cover generated text and historical compatibility

- Change new automatic cycle names and work automation notices to use the saved term. Keep existing notification event types and routes so recipients still open the right item.
- Update AI draft prompts and review text to recognize the chosen term while retaining the existing internal `sprints` JSON field.
- Update analytics, printable reports, and exports to display the selected term where a board or project is known. Preserve already stored item names and notification text.
- Audit user-visible strings with `rg -n -i '\bsprints?\b' src supabase --glob '*.ts' --glob '*.tsx' --glob '*.sql'`, classifying each match as UI/generated copy, historical data, or internal identifier. No visible hardcoded sprint label should remain in a project or board screen.

### 5. Verify and release after approval

- Test Stage defaults and a Phase override in a work project, a group board, and an individual board. In each, finish “Sprint 1” and “Sprint 2,” change the label, and verify both saved names remain while the next automatic name is “Phase 3.” Check singular/plural grammar, teacher read-only planning, leader handover, dates, carryover, notifications, reports, and existing `?work=sprints` / `?section=sprints` links.
- Run the new SQL suite, affected SQL suites, `anon-lockdown.test.sql`, Vitest, lint, and the production build. Review the diff for unchanged cycle behavior, then commit and push to main. Confirm Vercel serves the new build.

**Next:** The owner checks Stage/Phase naming on a work project, group board, and individual board on the live site.
