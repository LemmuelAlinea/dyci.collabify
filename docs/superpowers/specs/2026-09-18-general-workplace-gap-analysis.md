# What the upgrade asked for, and what is built

Written 2026-09-18, after the 14-task General workplace foundation landed on
`feature/general-workplace`. It reads the original request line by line against
the code that now exists, so nothing quietly falls off.

## The request, clause by clause

| # | What was asked | Status |
|---|---|---|
| 1 | Everything running today moves under an Education workplace | **Done.** `profiles.home_workplace`, `enter_education(p_role)`, every existing account defaults to Education and routes exactly as before |
| 2 | A General workplace for other kinds of projects | **Done.** Projects, members, teams, positions, access levels, grants, requests, invitations, join codes, fields, tasks, chat, notifications |
| 3 | Usable across all of DYCI, preschool to college | **Partly.** Nothing in the model is BSIT-specific any more, but there is no notion of a school level or a project kind, so a preschool teacher and a college dean start from the same blank project |
| 4 | Classroom, faculty-only and school-wide projects | **Partly.** Privacy comes from invitation, which covers faculty-only in practice. There is no project type that says which of the three a project is |
| 5 | Like GitHub: members really collaborate on the work | **Not built.** See "The three missing pieces" |
| 6 | An integrated repository: see the project, tasks, pushes, changes | **Partly.** Project and tasks are there. Pushes and changes are not |
| 7 | Who changed something and when | **Partly.** Task-level history is live (`general_task_events` renders through `describeEvent`). There is no history of the work itself — no file or document changed anything yet |
| 8 | Apply changes, review changes, commit changes | **Not built** |
| 9 | Research-paper projects: a folder that is viewable, editable, downloadable, reviewable, committable | **Not built.** Files exist only as attachments on a task |
| 10 | The site's own word file for paper projects | **Not built** |
| 11 | Research DYCI's real projects and turn them into presets | **Half.** The research is in the design doc (Robotics/ALAB, Project PAPEL, the campus greening action research, the programme list). No preset exists in the product |
| 12 | Every field of a project editable by whoever makes it | **Done.** Five core fields plus ten added field types, renameable, reorderable, removable, type-locked once they hold values |
| 13 | Roles inside a group that the creator names freely | **Done.** Positions are free text, project-wide or per team, many-to-many, renameable. They describe people and grant nothing — permissions are a separate axis |
| 14 | Two workplaces pickable at registration | **Done.** Plus a top-bar switcher and a one-time Education entry for a General account |

## The three missing pieces

These were deliberately deferred when the request was decomposed, each to its
own design and plan. They are the whole of what is left.

### Piece 3 — Project presets
A project kind chosen at creation that pre-fills the fields, the tasks and the
positions a real DYCI project of that sort needs: a research paper, a capstone
system, a robotics competition entry, an action research, a school event, an
accreditation requirement, an outreach activity, a thesis defence. Small, well
understood, and the research is already gathered. It also gives clauses 3 and 4
the "what kind of project is this" hook they are missing.

### Piece 4 — Shared documents
A document that lives in the project: written in the browser, versioned, with
changes a member proposes, an owner reviews and somebody commits, and a
download. This is the answer to clauses 9 and 10, and it is where most of the
"really collaborate" ask lands for the non-programming projects, which at a
school is most of them.

### Piece 5 — Code repository
Files, commits, diffs, reviews and history for system-development projects.

**One hard constraint, stated plainly:** pushing from a local machine with
`git push` needs a real Git server speaking the Git wire protocol. Supabase
cannot host one, and neither can Vercel's serverless functions. What is
reachable without new infrastructure is a repository the browser drives —
upload or edit files in the site, see a diff, open a change for review, comment
on it, and commit it, with full history. A true `git push` would need a
separate host, which is a cost and an operations decision, not a coding one.
That choice belongs to piece 5's own design.

## Smaller gaps found along the way

- The document title and landing copy still read "BSIT coursework at Dr. Yanga's
  Colleges" on every page, which is wrong now that the site serves the whole
  school. The consent copy likewise says "coursework information" to somebody
  signing up for General.
- General has no calendar, reports or analytics. Education has all three. This
  was out of scope by design, but it is a visible asymmetry.
- A project has no file area of its own — files hang off tasks only. Piece 4 and
  piece 5 both need one, so it should be built once, not twice.
- Progress is tasks-only. A paper project's progress is really its document's
  state, and a code project's is its commits.

## Suggested order

Piece 3 first: it is the smallest, it is already researched, and it gives every
later piece the project-kind hook. Then piece 4, which serves the larger share
of the school. Then piece 5, once the infrastructure question is answered.
