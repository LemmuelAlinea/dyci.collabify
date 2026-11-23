# Break down and balance: context, budget and cleaner owners

Status: approved · 2026-11-24

## Intent

A test of four task pairs in the Collabify project (bare title against a written description; results in the
plan) showed: a description makes subtasks match the real work, but totals stay 1.6–3× the task's estimate because
the AI never sees it; owners come through word collisions (Google Forms matched the web-dev "Forms" tag, ethics
matched "Security") and job-title-only matches; the hourly AI-limit message sits out of view.

## Decisions (owner)

- The estimate is a **budget, overruns explained**: subtasks aim at about the estimate; if the work truly needs more,
  the review shows the AI's one-sentence reason.
- The developers get realistic writing and research tags in the Collabify project (done: Technical writing and
  Research for Ivan, Keneth, Wilson; Diagrams for Keneth).

## Design

1. `work-ai` `breakdown` also sends the task's estimate (if any) and the project's name and description (capped at
   2,000 characters, member names masked). No SQL change: the function reads them through the caller's client.
2. Prompt: size the whole task first; with an estimate, make the subtasks add up to within about 20% of it, else
   return `note`, one sentence on why it needs more (never padding); prefer 3–8 subtasks of at least 30 minutes, no
   filler steps; use the project description for the field (software, research, medical…) and its usual steps; use a
   skill tag only when the subtask needs that skill as the team means it, never for a shared word.
3. The function returns `{ rows, note }`; the review shows the note under the total, with the estimate.
4. Owner rule (`balanceWorkPlan`): when a subtask names skill tags, a person who matches none of them is not a
   partial match (a job title alone no longer qualifies) unless nobody matches a tag; then the position holders, then
   everyone ("No one here …"), as today. The spreading weights stay.
5. The setup step's error (the AI limit, a failed draft) shows just above the buttons and scrolls into view.

## Non-goals

A team summary for the AI (tags and positions already describe the team), per-person speed, a hard cap.
