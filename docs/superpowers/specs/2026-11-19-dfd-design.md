# Collabify Data Flow Diagrams (Level 0 and Level 1): design

## Intent

Thesis figures for Chapter 3. They show how data moves between the people and services outside
Collabify and the system's main processes and data stores. The scope follows
`docs/scope-and-delimitation-updated.md`. Nothing in the app changes.

## Goals, non-goals, anti-goals

- Goals: a Level 0 context diagram and one Level 1 diagram, in Gane & Sarson notation, as
  PNG (for Word), SVG and an editable draw.io file, plus a short text guide for the thesis.
- Non-goals: Level 2 diagrams, ERDs, use-case diagrams, any change to the app or schema.
- Anti-goals: diagrams that name database tables or code (a panel reads processes, not
  `general_tasks`); tangled crossing lines; flows that are not real (every flow must match
  something Collabify does today).

## Approaches

| Approach | Trade-off | Picked |
|---|---|---|
| One Node script writes SVG and .drawio from one layout, Chrome renders the PNG | Exact shapes, the files always match, one edit fixes both | **Yes** (user's pick) |
| Hand-written .drawio, user exports images | Simpler, but images not produced and edits happen twice | No |
| Mermaid auto-layout | No true Gane & Sarson shapes, tangled with 10 processes | No |

## Notation (Gane & Sarson)

- External entity: square box. Shown twice when that avoids a long crossing line, marked with
  a diagonal stroke in the corner (standard duplicate mark).
- Process: rounded rectangle with a top band holding the number (0, 1.0 ... 10.0).
- Data store: open-ended rectangle with an ID cell (D1 ... D10).
- Data flow: arrow labeled with a noun phrase ("class join code", not "joins class").

## External entities

Student · Teaching member · Work-project member (Project manager, Coordinator, Member, QA,
Stakeholder) · Admin · Email service (Brevo) · Microsoft sign-in · AI services (Claude, Groq
Whisper) · OneSignal (device notifications).

## Level 0: context diagram

One process, **0 Collabify**. Main flows (in → into Collabify, out → back to the entity):

| Entity | Into Collabify | Out of Collabify |
|---|---|---|
| Student | sign-up and sign-in details, class join code, task updates and files, messages, hand-ins, peer ratings, privacy requests | class and project details, held tasks, grades and feedback, announcements, notifications |
| Teaching member | class details, syllabi, project briefs and rubrics, group sets, hand-in decisions, scores, reassignment decisions, announcements | hand-ins, class analytics and reports, peer evaluation results, notifications |
| Work-project member | space and project details, tasks and routing decisions, QA decisions, stakeholder feedback, files and reviews, rules and settings, messages and meetings | project boards, progress and reports, feedback replies, notifications |
| Admin | accounts and switches, bulk registration file, offices and heads, program notices, organization settings, sections and program library, privacy decisions, offboarding choices | organization overview, audit log, privacy request queue, program oversight figures |
| Email service | — | confirmation and password reset emails |
| Microsoft sign-in | identity confirmation | sign-in request |
| AI services | drafts, extracted syllabus weeks, transcripts, answers | prompts with text, files and voice recordings |
| OneSignal | — | device notifications |

## Level 1

### Processes

| # | Process | Entities | Stores |
|---|---|---|---|
| 1.0 | Manage accounts and access | all four people, Email service, Microsoft sign-in | D1, D10 |
| 2.0 | Manage classes and groups | Teaching member, Student, AI services (syllabus reading) | D1, D2, D3 |
| 3.0 | Run class projects and grading | Teaching member, Student, AI services (briefs, rubrics) | D2, D3, D4, D6 |
| 4.0 | Manage work spaces and projects | Work-project member, Admin (oversight, recovery) | D1, D5 |
| 5.0 | Plan, assign and track tasks (handoff, sprints, milestones, QA, workflow rules) | Work-project member, Student, AI services (task drafts, assign by position) | D5, D6 |
| 6.0 | Manage files and reviews | Student, Teaching member (read), Work-project member, AI services | D5, D7 |
| 7.0 | Communicate and meet (Inbox, discussions, announcements, meetings) | all four people, AI services (transcription) | D2, D5, D8 |
| 8.0 | Send notifications and reminders | all four people, OneSignal | D6, D8, D9 |
| 9.0 | Produce reports and analytics | Teaching member, Work-project member | D4, D6, D7 |
| 10.0 | Administer organization and compliance (offices, notices, settings, audit, privacy) | Admin, all users (privacy requests) | D1, D3, D8, D10 |

### Data stores

| ID | Store | Holds |
|---|---|---|
| D1 | Accounts and offices | profiles, account type, switches, consents, offices, office heads |
| D2 | Classes and groups | classes, rosters, co-teachers, group sets, groups |
| D3 | Syllabi and curriculum | syllabus weeks, curricula, sections, program library |
| D4 | Class projects and grades | briefs, rubrics, hand-ins, peer evaluations, scores |
| D5 | Spaces and projects | spaces, projects, roles, teams, positions, settings, feedback |
| D6 | Tasks | tasks, sprints, milestones, task history, time logs, rules |
| D7 | File repository | Main, drafts, commits, reviews, shares |
| D8 | Messages and meetings | conversations, discussions, announcements, program notices, meetings |
| D9 | Notifications | notifications, preferences, device subscriptions |
| D10 | Organization records | organization settings, audit log, privacy requests |

Level 1 keeps the Level 0 flows balanced: every flow on Level 0 appears on Level 1 against the
process that handles it.

## Deliverables (in `docs/dfd/`)

- `collabify-dfd-level0.png` / `.svg`, `collabify-dfd-level1.png` / `.svg`
- `collabify-dfd.drawio` (two pages: Level 0, Level 1)
- `build-dfd.mjs`, the generator (`node docs/dfd/build-dfd.mjs`)
- `README.md`: legend, and one-paragraph descriptions of each process and store for the
  thesis text

## Changes made while building

`docs/dfd/README.md` is the final reference. The tables above changed in these ways so the
layout reads left to right with few crossings:

- Processes renumbered by position: top row 1.0 Accounts, 2.0 Organization, 3.0 Classes,
  4.0 Class projects, 5.0 Reports; bottom row 6.0 Communicate, 7.0 Notifications, 8.0 Spaces,
  9.0 Tasks, 10.0 Files.
- D1 is Accounts only; offices and office heads moved to D10 Organization records.
- Every person (not only the Student) sends sign-in details and privacy requests to 1.0, as one
  converging flow. 6.0 and 7.0 send to people as diverging flows.
- Program notices go through 6.0 Communicate rather than the organization process.
- 7.0 gets its input from D8 and from 9.0 (task events) instead of reading D6.

## Builder's calls

- Layout: landscape, black on white, one font (Arial, so Word and draw.io match), PNG at 3x
  scale for print.
- The Word PDF converter and Vercel stay out: they host or render, they don't exchange data
  with users in a way a DFD shows.
- Exact flow labels may be shortened to fit; meaning stays the same.
- Committed locally, not pushed (docs only, nothing deploys).
