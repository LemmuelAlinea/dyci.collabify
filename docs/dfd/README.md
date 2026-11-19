# Collabify data flow diagrams

Level 0 (context diagram) and Level 1 of Collabify, in Gane & Sarson notation, for the thesis.

| File | Use |
|---|---|
| `collabify-dfd-level0.png`, `collabify-dfd-level1.png` | Paste into Word (4800 × 3000 and 6600 × 4440 px, 3× scale) |
| `collabify-dfd-level0.svg`, `collabify-dfd-level1.svg` | Sharp at any size, for PDF or print |
| `collabify-dfd.drawio` | Editable in draw.io (app.diagrams.net or the desktop app): two pages, Level 0 and Level 1 |
| `dfd-data.mjs` | What each diagram holds and where it sits |
| `build-dfd.mjs` | Builds all of the above |

Rebuild after changing `dfd-data.mjs`:

```bash
node docs/dfd/build-dfd.mjs --png
```

The build stops if Level 1 does not balance Level 0: every item of every Level 0 flow must
appear on Level 1 between the same entity and a process, in the same direction, and Level 1
may not add any. It also warns when a label covers a box or another label. Level 1 should be
placed on a landscape long bond page (8.5 × 13 in) so its labels stay readable in print.

Edits made by hand in draw.io are not read back by the build. Pick one place to edit: the
data file (and rebuild), or the draw.io file (and export the images from draw.io).

## Legend

| Symbol | Meaning |
|---|---|
| Square box | External entity: a person or outside service that sends or receives data |
| Square box with a stroke in the lower-left corner | The same external entity, drawn more than once to keep lines short |
| Rounded box with a numbered band | Process |
| Box open on the right, with an ID cell | Data store |
| Arrow | Data flow, labeled with the data it carries |
| Lines joining at a bar, one arrowhead | Several entities sending to one process (converging flow) |
| One line splitting to several arrowheads | One process sending the same data to several entities (diverging flow) |

## External entities

| Entity | Who or what |
|---|---|
| Student | Student account |
| Teaching member | Member with the Can teach switch |
| Work-project member | Anyone with a role in a work space or work project: Project manager, Coordinator, Member, QA or Stakeholder (a student can hold any role except Project manager) |
| Admin | The administrator account |
| Email service (Brevo) | Sends account confirmation and password reset emails |
| Microsoft sign-in | Microsoft Entra ID; confirms identity for Microsoft sign-in |
| AI services (Claude, Groq Whisper) | Claude for text drafts, extraction and answers; Groq Whisper for voice transcription |
| OneSignal | Delivers device notifications |

## Level 0

One process, **0 Collabify**, exchanges data with the eight external entities. Each person's
two flows list everything that person sends in and receives back; the Level 1 processes below
split those lists.

## Level 1 processes

| No. | Process | What it does |
|---|---|---|
| 1.0 | Manage accounts and access | Registers and signs people in (email and password or Microsoft), records policy consent and privacy requests, sends confirmation and reset emails, and gives the Admin the account directory, account switches, bulk registration and offboarding. |
| 2.0 | Administer organization and compliance | Keeps offices and office heads, organization settings, sections and the program library, and the audit log; lets the Admin answer privacy requests and read the organization overview. |
| 3.0 | Manage classes and groups | Creates classes, admits students by join code, keeps rosters and group sets, and stores syllabi, with AI reading uploaded syllabus files into weeks. Passes syllabus weeks to 4.0. |
| 4.0 | Run class projects and grading | Publishes project briefs and rubrics (AI can draft them), runs each group's board, takes hand-ins, peer ratings and scores, and returns grades and feedback. |
| 5.0 | Produce reports and analytics | Reads grades, task activity and file history to produce class analytics and reports, work progress reports and the Admin's program oversight figures. |
| 6.0 | Communicate and meet | Carries messages, announcements, meetings and program notices, with AI transcribing voice messages. |
| 7.0 | Send notifications and reminders | Turns new messages, notices and task events into notifications, keeps each person's preferences and devices, and sends device notifications through OneSignal. |
| 8.0 | Manage work spaces and projects | Creates spaces and projects, keeps roles, teams and stakeholder feedback, imports member rosters (AI reads the file into a review), and lets the Admin assign a Project manager. |
| 9.0 | Plan, assign and track tasks | Plans, routes and assigns work tasks, runs sprints, milestones, QA and workflow rules, and uses AI for task drafts and holder suggestions. Passes task events to 7.0. |
| 10.0 | Manage files and reviews | Keeps each project's Main files, drafts, commits and reviews, and uses AI for summaries, commit messages and answers about the files. |

## Data stores

| ID | Store | Holds |
|---|---|---|
| D1 | Accounts | Profiles, account type, switches and status, policy consents |
| D2 | Classes and groups | Classes, rosters, co-teachers, group sets and groups |
| D3 | Syllabi and curriculum | Syllabus weeks, curricula, sections and the program library |
| D4 | Class projects and grades | Briefs, rubrics, hand-ins, peer evaluations and scores |
| D5 | Spaces and projects | Spaces, projects, roles, teams, positions, skills, settings and stakeholder feedback |
| D6 | Tasks | Tasks, subtasks, sprints, milestones, task history, time logs and workflow rules |
| D7 | File repository | Main files, drafts, commits, reviews and shares |
| D8 | Messages and meetings | Conversations, discussions, announcements, program notices and meetings |
| D9 | Notifications | Notifications, notification preferences and device subscriptions |
| D10 | Organization records | Offices, office heads, organization settings, the audit log and privacy requests |

## Simplifications

- Every person signs in through 1.0; the Admin's account is not created by sign-up.
- Other events also raise notifications (hand-ins, grades, meetings, reminders). Level 1 shows
  the two largest sources, new messages and notices (D8) and task events (9.0), to keep the
  diagram readable.
- Hosting (Vercel, Supabase) and the Word preview converter are not entities: they run
  Collabify rather than exchange data with it.
- Two flows cross on Level 1: 5.0 reading D6 crosses 4.0 writing D4, and the task events lane
  from 9.0 crosses 8.0 writing D5.
