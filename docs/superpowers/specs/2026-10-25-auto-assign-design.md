# Assign by position: design

Date: 2026-10-25. Status: draft for approval, builder-checked.

## Intent

A work project already has teams, positions (Frontend developer, Backend developer,
Researcher, Quality tester…) and tasks. Today the project manager reads every task and
picks a person by hand. This feature lets the PM or a coordinator have the AI **draft**
who should hold each task, based on the positions people hold and on per-project skill
tags, then review and edit that draft before anything is saved.

It has to work for any kind of project: a system-development team (design tasks go to the
frontend developer), a research team (literature-review tasks go to the researcher), or
anything else. The AI reads whatever the project calls its positions and tags. Nothing is
hardcoded to software roles.

## Goals

- **Assign by position:** one action on a work project's Work tab drafts an assignee for
  every open task that nobody holds yet.
- **Tasks from notes** on a work project suggests a person by position or tag for every
  drafted task the notes don't name someone for.
- Members get **skill tags** per project, used together with positions.
- Work spreads evenly: when several people fit, the one with the lightest load gets it.
- The PM reviews before saving. They see the person and the reason, can change it, and
  nothing is written until they save.

## Non-goals

- Class projects and class boards. They keep today's behaviour, and the class Tasks from
  notes (`ClassTasksFromNotes`) gets no suggestions.
- Reassigning tasks someone already holds. Only unassigned tasks are drafted.
- Assigning automatically without review, or on a schedule.
- Skill tags on the account or profile. Tags are per project only.
- Changing what positions grant. They still grant no permission.

## Anti-goals (a failure even if it works)

- The draft writes anything before the PM presses Save.
- The draft puts QA, a stakeholder, or someone not accepted into the project on a task.
  The database already refuses these, so the draft must never offer them.
- One person ends up with everything because the AI favours the first name it sees.
- The AI makes up a match. Every reason shown must be a real position the person holds or
  a real tag they have.
- A person named in the notes is overridden by a position guess.

## Decisions the user made

1. **Both entry points:** Assign by position for existing unassigned tasks, and
   suggestions in Tasks from notes.
2. **Skill tags per member, per project, used together with positions.** Position first;
   tags break ties between positions or cover tasks no position fits.
3. **Who sets tags:** a member edits their own; the PM and coordinators can edit anyone's.
4. **Ties:** among the people who fit, the one with the fewest open tasks in this project
   gets the task.
5. **No match:** the task stays unassigned and the draft marks it "No position fits".
6. **Review:** each row shows the task, the person, and what matched ("Frontend
   developer", "tag: Figma"). The PM can change the person, edit the title, or drop the row
   before saving.
7. Only the PM and coordinators run it. Team leads don't.
8. **A notes-named person who can't hold tasks** (QA, a stakeholder, someone rejected, or
   anyone not accepted into the project) is dropped, and the row goes to `assign` for a
   suggestion by position. The reason line says so, e.g. "Named Ana (QA can't hold
   tasks), suggested by position". It covers every case of the person not being a
   candidate (see Who is eligible). This replaces today's stakeholder-only filter in
   `TasksFromNotes.tsx`.
9. **QA stage:** in a project with active QA (`has_qa`), Assign by position skips tasks at
   the QA stage or after it. Bug tasks before the QA stage are drafted like any other
   task, because a developer has to fix them.

## How it works

### Skill tags

- New table `general_member_skills (project_id, user_id, tag)`. The primary key is all
  three. It has a foreign key to `general_members (project_id, user_id)` on delete cascade.
  A tag is trimmed text of 1–40 characters, unique per person per project ignoring case,
  and a person has at most 12.
- RLS: project members read (`is_general_member`). A member inserts and deletes their own
  rows when `general_can_write(project)` holds. Holders of `manage_structure` or
  `manage_tasks` on the project edit anyone's. The frozen and archived project guard
  applies, as it does for positions.
- Tags can't be given to QA or stakeholders, because they're never assigned. The insert
  policy refuses them.
  - When someone's role changes to `qa` or `stakeholder`, an `after update of role`
    trigger on `general_members`, owned by `member-skills.sql`, deletes their tags.
  - This is my call. A trigger keeps the file from redefining `set_general_member_role`,
    which `project-qa.sql` owns, so `member-skills.sql` stays out of the re-run chain.
- UI: on the Members tab, each member's row shows their tags as chips. An editor (the
  person themself, or a PM or coordinator) adds a tag by typing and pressing Enter, and
  removes one with the chip's ×. Copy: "Skills", empty state "No skills yet".

### Who is eligible

- A candidate is a project member who is not rejected, whose role is `pm`, `coordinator`
  or `member`, and who may hold tasks. QA and stakeholders never qualify.
- A candidate's **load** is the number of their open tasks in this project: not done and
  not archived. Tasks given out earlier in the same draft count toward it.

### The match (AI) and the pick (app)

The AI **does not choose people.** It chooses a match for each task: one position name or
one skill tag from the lists it's given, or none. The app then picks the person.

- `work-ai` gets a new action, `assign`, with its own hourly and daily limits.
  *(Builder's call; suggested 12 per hour and 50 per day, like `tasks`.)*
  - It is allowed only when the caller holds `manage_tasks` on the project, checked in SQL
    through `general_has`. That covers the PM, coordinators and anyone granted Manage all
    tasks.
- **Input to the model:**
  - the project's positions, each under a short id (`p1`, `p2`…) with its name, its team
    name if any, and how many eligible people hold it. Position names can repeat across
    teams, so the model returns the id, not the name. This is my call.
  - the distinct skill tags held by eligible people;
  - the tasks: id, title, description and team name.
  - No names, emails or loads are sent.
- **Output per task:**
  - `match_kind` (`position`, `tag` or `none`);
  - `match` (the position id or the exact tag);
  - a short `reason` of at most about twelve words, e.g. "Screen design is frontend work".
- **Prompt rules:**
  - Prefer a position.
  - Use a tag only when no position fits, or to choose between positions that fit equally.
  - Never return a name that isn't in the lists.
  - Return `none` rather than stretch a match.
  - A task tied to a team prefers positions in that team.
- **The app's pick:**
  - Drop any match that isn't in the lists.
  - Candidates are the eligible holders of the matched position, or the eligible people
    with the matched tag.
  - If the task has a team, prefer candidates who are in that team when any exist. "In
    that team" means a row in `general_team_members`, not holding a position tied to the
    team. This is my call.
  - Pick the lowest load. Break ties by the most matching tags on the task's wording, then
    by name, so the result is stable.
  - Add one to that person's load before the next task.
  - No candidate means "No position fits".
- **Where the pick runs:** in the edge function, so both entry points share it. The
  function returns the chosen person's id plus the match and reason.

### Entry point 1: Assign by position

- **The button:** "Assign by position" on the work project's Tasks view, next to "From
  notes". It is shown only to holders of `manage_tasks`, on work projects that aren't
  archived.
- **The draft:**
  - It covers open, unassigned, non-archived tasks, capped at 60 per run, oldest first.
  - When the project has active QA, it leaves out tasks at the QA stage or after it. The
    function computes the QA stage the same way `lib/work/qa.ts` does: from the project's
    `qa_stage` and stages.
  - When there are more, the review says how many were left for the next run.
  - It opens a review dialog styled like the Tasks from notes review.
- **Each row:**
  - a checkbox (checked);
  - the title, editable inline;
  - the person, a picker of eligible members that allows several, like the task dialog;
  - a reason line, e.g. "Frontend developer · Screen design is frontend work", "tag:
    Figma · …", or "No position fits" in muted text with nobody picked.
- **Save:**
  - It applies the checked rows: title changes, then assignees.
  - It goes through the same API paths the task dialog uses, so every existing guard,
    event and notification still runs. Assigned people get the usual assignment
    notification.
  - A row whose task gained an assignee meanwhile, or was archived, is skipped and
    reported: "2 tasks changed while you were reviewing and were left as they are."
- **Empty states:**
  - "Every open task already has someone on it."
  - "Add positions or skills on the Members tab first." This shows when there are no
    positions and no tags.

### Entry point 2: Tasks from notes (work projects)

- The existing `tasks` action is unchanged: a person the notes name still wins.
- After the `tasks` draft comes back, rows with no assignee are sent to `assign`. That
  second call doesn't count against the user's limit, or counts as one call.
  *(Builder's call.)* The rows' person and reason fill in from the result.
- Rows show the same reason line. A notes-named person shows "Named in the notes".
- The rest of the Tasks from notes review and save flow is unchanged.
- If the `assign` call fails, the draft still shows, with those rows unassigned and a
  quiet note: "Couldn't suggest people this time."

## Constraints

- Follow CLAUDE.md:
  - design tokens only;
  - copy rules (sentence case, no "please", "successfully" or exclamation marks);
  - desktop first, then tablet, then phone;
  - `npm run build` passes.
- New SQL goes in a new file, `supabase/member-skills.sql`, which runs after the
  company-roles chain. It owns `general_member_skills` and its policies. Add it to the
  rebuild order in `docs/07-backup.md` and to the `scripts/schema-drift.mjs` ORDER.
  - If it must redefine a function one of the seven owns (for example a frozen-project
    guard list), it starts from the live `pg_get_functiondef`. Then it becomes the last
    owner, and the re-run rules in CLAUDE.md gain it.
- Tests:
  - an SQL test file `supabase/tests/member-skills.test.sql` for RLS: self, PM,
    coordinator, plain member editing another person, stakeholder, QA, archived project;
  - Vitest for the pick (load balance, team preference, ties, invalid match dropped, QA
    and stakeholder excluded, load carried within a draft).
  - The pick lives in a pure module the edge function and the tests both import. It sits
    in `supabase/functions/_shared/` or is mirrored in `src/lib/work/`; the builder
    chooses, but there is one source of truth.
- Model: the same model and `ask` helper `work-ai` already uses.

## Left to the builder

- Exact layout of the review dialog and the tag chips, within the existing patterns.
- Whether the Assign by position review is a new component or an extension of the Tasks
  from notes review component.
- Limits, and how the chained call in Tasks from notes is counted (noted above).
