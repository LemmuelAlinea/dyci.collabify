# Break down and balance: skills as a preference

Status: approved · 2026-11-24 · changes the owner rule in `2026-11-22-space-workload-balancing-design.md`

## Intent

The panelist asked to see workload balancing. Breaking down "Build the Landing page" gave Ivan 16 h of 30.5 h,
because the owner rule only considers people with **every** label a subtask names (position and tags). Ivan was the
only one with all of Junior dev, React, Tailwind CSS and UI, so every UI subtask went to him while Wilson (Junior dev,
React) and Keneth had room. Asana and ClickUp balance on capacity and treat skills as a preference; Collabify should
too.

## Decision (owner)

Option A: give each subtask to the best person, unless they are getting busy, then to the next-best person who has
some of its skills and more room. Rejected: changing only the demo data; a toggle between skill match and spread.

## Rule

- A subtask's labels are its position (if any) and its tags. A person's fit is the share of those labels they have,
  with a position counting half a tag (it says what someone is, a tag what they can do; my call after simulating the
  landing page: at full weight Wilson took the responsive subtask on his Junior dev title alone).
- No labels: everyone may take it (as today). Labels nobody has: everyone may take it (as today, "No one here …").
- Otherwise anyone with a fit above 0 may take it. Among those with room for it (never past their hours, as today),
  the lowest score wins: projected load ÷ available after taking it, plus 0.25 × (1 − fit). A full match keeps winning
  until their load share is about 25 points × (1 − the other's fit) above a partial match's.
- Ties: the better fit, then the lower id. Pinned rows, the no-room and unknown-hours cases stay as today.
- Rows are placed rarest skills first (fewest full matches), then largest, as today.
- Each card says why: "Only Ivan Caburnay …" for a sole full match, "Wilson Mendoza holds Junior dev and is tagged
  React and has more room than Ivan Caburnay." for a partial match.

## Review

Under the subtask total: "Share of each person's hours: Ivan Caburnay 20% · Wilson Mendoza 18% · …" (hours this plan
adds ÷ their available hours in the window), for people with hours.

## Non-goals

Per-person speed, changing the AI's subtasks or estimates, a toggle. No SQL change.

## Checked against the real team (my call on the weights)

Simulated with Collabify's real tags and a nine-subtask landing page (`spreads a landing page across the people who can
do it` in `src/lib/work/workloadPlan.test.ts`): Ivan 13 h (header, features, responsive), Wilson 6 h (scaffold,
contact form), Luke 5 h (outline, pricing), Keneth 3.5 h (QA), Lemmuel 3 h (deploy), where the old rule gave Ivan
16 h. Skill weights 0.1–0.2 gave Wilson's full-match contact form to Luke; 0.5 put Ivan back at 16 h.
