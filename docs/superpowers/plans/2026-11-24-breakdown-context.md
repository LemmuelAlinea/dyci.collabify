# Breakdown context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break down and balance plans to the task's estimate with the project's context, and picks owners without
word collisions.

**Architecture:** The `work-ai` breakdown action reads the estimate and project description itself and asks for a
`note`; the shared owner rule tightens partial matches; the dialog shows the note and keeps errors in view.

**Tech Stack:** Deno Edge Function (`work-ai`), React + TS, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-breakdown-context-design.md`

## Global Constraints

- The model never sees member names, ids, hours or skills of specific people (names masked with `maskMemberNames`).
- Copy: sentence case, no "please", no "successfully". Tokens only.
- Deploy `work-ai` with the frontend: `npx supabase functions deploy work-ai --project-ref jublbxdqzcjmbunukxct --use-api`.

## Review Focus

- A task with no estimate: no budget line in the prompt, no note expected, review unchanged.
- A project with no description: the prompt says so; nothing breaks.
- A note longer than one sentence or containing ids (t1, p1, c1, person2): trimmed to 300 characters, ids replaced.
- A subtask whose tags nobody has: falls back as today ("No one here …"), not to title-only holders silently.
- The AI limit message on the setup step is visible without scrolling.

---

### Task 1: Owner rule ignores title-only and no-tag matches

**Files:** `supabase/functions/_shared/workloadPlan.ts` (`groupFor`), test `src/lib/work/workloadPlan.test.ts`

- [ ] Tests: `a job title alone is not a partial match when someone has a tag` (row Junior dev + [Systems analysis,
  Code review]; Luke has both tags but no room left for it, Wilson holds only Junior dev → unassigned "no room",
  not Wilson); `title holders take it when nobody has any tag` (row Junior dev + [Kubernetes] → a Junior dev holder,
  note "No one here … is tagged with Kubernetes"-style stays for the tag-less case only when nobody holds the title).
  Existing landing-page and spreading tests stay green.
- [ ] Rule: when `row.tags.length > 0`, qualified = people with at least one matching tag; if none, people holding the
  position; if none, everyone (untagged). Rows with only a position keep today's behavior.
- [ ] Run `npx vitest run src/lib/work/workloadPlan.test.ts`; commit "Stop job-title-only matches from taking skilled work".

### Task 2: Context, budget and note in work-ai

**Files:** `supabase/functions/work-ai/index.ts` (`breakdownAction`), `supabase/functions/_shared/workloadPlan.ts`
(`readableNote(note): string`), test `src/lib/work/workloadPlan.test.ts`, `src/lib/api/workAi.ts`
(`draftBreakdown` returns `{ rows, note: string | null }`)

- [ ] Tests for `readableNote`: trims, caps at 300 characters, replaces `t1`/`p1`/`c1`/`person2` with plain words,
  empty → null.
- [ ] Read `general_tasks.estimated_minutes` for the parent and `general_projects.name, description` via `ctx.caller`;
  add to the user message ("Task estimate: 8 h" or "Task estimate: none"; "Project: … / Project description: …" or
  "Project description: none"); add the prompt rules from the spec; schema gains `note` (string, may be empty).
- [ ] Syntax check `npx esbuild supabase/functions/work-ai/index.ts --loader:.ts=ts --format=esm --outfile=/dev/null`;
  commit "Give the breakdown its estimate and the project's description".

### Task 3: Review shows the note; setup errors stay in view

**Files:** `src/components/general/WorkloadPlanDialog.tsx`, test `src/components/general/WorkloadPlanDialog.test.tsx`

- [ ] Tests: `shows the AI's note beside the total` (draft returns note → text visible under "… in all");
  `shows a draft error above the buttons` (draft fails "That is 12 in an hour. Try again later." → the alert is the
  last block before the footer).
- [ ] Store the note with the rows (cleared on redraft); render under the summary line. Move the setup `Alert` to the
  end of the setup body and scroll it into view when set.
- [ ] `npx vitest run`, `npm run build`; deploy `work-ai`; draft tasks A–D (described) again in Collabify and compare
  with the first run; commit "Show the breakdown's note and keep its errors in view" with the results in `handoff.md`.
