# Work project handoff: design

Date: 2026-10-28. Status: draft for owner approval.

## Intent

Make a work project run like a managed company project: a stakeholder brings a
request to a Space, a project manager agrees on the brief and creates the
project, a coordinator can review the work plan, teams receive deliberate
handoffs, leads assign their own members, members do the work, and QA checks it.
The handoff must make ownership clear without forcing every project through
the same number of approvals.

## Current state

- A Space has members and reusable teams. A project can seed from a Space team,
  but project roles, team leads, positions and skill tags live in the project.
- Stakeholders can use Feedback only after a project exists. A Space has no
  project-request thread.
- All project members can currently read all tasks. Members and team leads can
  create ordinary tasks. The PM and coordinators can manage all tasks and run
  Assign by position, which currently suggests individual holders across the
  project. QA can raise bug tasks.
- Tasks already have a team, holders, stages and activity. No field says whether
  a task is still a private plan, awaiting coordinator review, or sent to a team.

## Goals

1. A stakeholder and PM can agree on a request inside their shared Space before
   a project exists. Creating a project from it carries the agreed brief over.
2. The Space is a reusable roster. Each project chooses its own coordinator,
   stakeholder, QA, teams and leads; those choices do not change other projects.
3. Only PMs and coordinators create regular tasks through Add task and From
   notes. QA can still create bug tasks. Team leads assign work sent to their
   teams, but do not create regular tasks.
4. A PM can send tasks to a coordinator for review, or send directly to teams.
   A coordinator can edit, organize, return or send reviewed tasks.
5. A PM or coordinator can select tasks, set a different team on each row, and
   use **Send to team** once for the batch. Setting a team while planning does
   not send the task.
6. Before a task is sent to a team, only PMs and coordinators can see it. A QA
   creator can also see their own unsent bug. After release, retain the current
   project-wide read access. A lead's dedicated inbox shows only released,
   unassigned tasks for teams they lead.
7. A team lead's Assign by position drafts holders only from members of that
   lead's team and only for tasks in their incoming queue. The lead reviews
   suggestions before saving. Existing QA stage and pass/send-back rules remain.

## Non-goals

- No mandatory coordinator: a small project may go PM to team.
- No package object, general workflow builder, automatic sending, or automatic
  assignment without human review.
- No change to class projects or their task permissions.
- No Space-wide project roles. Space membership is a source roster, not an
  automatic coordinator or QA appointment on every project.

## Anti-goals

- A task appears in a lead's inbox because someone merely selected its team.
- An unsent plan appears in a member's task list, calendar, notification, or
  progress counts. Hiding only the task card would not satisfy this.
- A lead's AI suggestion includes someone outside their team, QA, a stakeholder,
  or an inactive member.
- A handoff silently loses an edit, sends a task to the wrong team, or leaves a
  task without a responsible person able to act on it.
- The frontend hides an action while a direct API call can still perform it.

## Approaches

**A. Route each task (chosen).** Add routing state and handoff metadata to
existing work tasks. A batch action changes several selected tasks, each with
its own destination team. Inbox views query those task states. Existing task
activity records each transition. This supports mixed-team batches without a
new package hierarchy.

**B. Work packages (not chosen).** Create a package containing tasks and move
the package between roles. It offers a formal bundle record but makes splitting
or rerouting one task unnecessarily heavy.

## Agreed behavior

### Space request and project setup

- A Space member can start a **Project request** and discuss it with the Space
  owner or managers who may create projects. The request holds a title, brief,
  desired outcome and optional target date. The discussion stays attached to
  the request. This is a pre-project conversation, not the existing project
  Feedback tab.
- A PM marks the request ready and creates a project from it. The new project
  gets the agreed title, brief and date as editable starting values, and keeps
  a link back to its request. The request remains a record of the decision.
  Its discussion stays private to the requester and Space managers; other
  project members see the agreed brief in the project, not the negotiation.
- The PM selects project people from the Space roster. Space teams can seed
  project teams; the PM can then choose project-specific membership and leads.
  Space team changes do not silently change existing projects.

### Task routing

The work routing state is separate from the existing task stage. A task may be
in the project's “In progress” stage while its routing state says which team
received it; QA and Done remain stage decisions, not handoff states.

1. **Planning.** PM or coordinator creates and edits a task. They may set its
   team, sprint, dates and priority. It is private to planners. QA bug tasks
   enter the same planning queue, visible to their QA creator and planners.
2. **Coordinator review, when chosen.** PM selects tasks and sends them to one
   coordinator. That coordinator sees a review queue, can edit them, return
   them to the PM with a note, or prepare them for teams. Other coordinators
   retain planner access. The PM can still intervene.
3. **Send to team.** PM or coordinator selects tasks and confirms a destination
   team for each. One action validates the whole batch and releases it. Each
   team's lead receives an inbox notification for their own tasks. A team must
   have a lead before it can receive a task; planners can change the lead first.
4. **Lead assignment.** The lead sees incoming, unassigned tasks for teams they
   lead. They may assign team members manually or run Assign by position over
   only that queue. Suggestions use the project's positions and skills but
   candidate members must belong to that team. The review is editable and
   saves only after confirmation. Assigned members see the tasks in their work.
5. **Execution and QA.** Members update work and move stages under the existing
   task and QA guards. Leads may return an incoming task to the PM/coordinator
   with a required reason when the team cannot take it. A returned task leaves
   the lead's inbox, becomes private planning work again, and needs a new Send
   to team. The lead can see the return receipt and reason in their history.
   A PM or coordinator may reroute a released task that is already in progress.
   They must confirm the change and give a reason. The send clears the old
   holders, notifies both teams, and records the reason, people and teams in
   task activity. The task's stage, files, comments and work history remain;
   the new lead receives it in Incoming and chooses new holders. A task in QA
   or Done must be reopened under the existing stage and QA rules first.

The PM and coordinator keep their current ability to manage a released task if
a lead is unavailable. Their Assign by position action, before team handoff,
suggests a **destination team** for unassigned planning tasks; the lead's action
suggests **people within that team**. Both remain drafts until reviewed. From
notes produces planning tasks and may suggest teams, but never sends them.

## Visibility and safeguards

- Enforce task visibility and actions in SQL/RLS or guarded functions, then
  mirror those rules in the UI. A planner-only task and its comments, files,
  events, search results, counts and notifications must not leak through a
  related table or summary RPC. A QA creator sees their own unsent bug.
- Released tasks remain readable to project members, including stakeholders,
  under their existing read-only rules. A lead's inbox is a scoped view, not a
  new project role. Stakeholders never receive task assignments.
- A send operation checks current role, project archive status, task routing
  state, team membership/lead, and conflicting assignees in one transaction.
  Concurrent edits fail with a reload message; no partial batch is sent.
- Record who sent, returned, assigned or rerouted each task, when, the old and
  new destination, and any return reason in task activity. Notify only the
  people who need the next action.
- Existing tasks retain their visibility and assignments on migration. Treat
  them as already released; do not hide current project work retroactively.

## Proposed builder calls

- Put Project requests in the Space's Projects area, with a request list and
  discussion panel. Restrict a request to its author and Space managers until
  and after project creation. The link appears only to those readers.
- Reuse the existing project team and task tables where possible. Add only the
  routing data needed for visibility, queues and audit. Keep routing state
  separate from project stage/status.
- Keep project skill tags per project. When seeding from a Space team, copy its
  members as a starting point; set project skills during project setup. A
  reusable Space skill directory can be considered later if multiple projects
  show repeated setup cost.
- Give planners a Planning/Coordinator review view and leads an Incoming view
  within the existing Tasks tab; keep the normal board for released work.
- Retain manual assignment and PM/coordinator override for exceptional cases,
  with the same audit and review safeguards as a lead assignment.

## Constraints and verification

- Follow `CLAUDE.md`: design tokens, copy, desktop/tablet/phone layout, current
  project roles, QA guard, idempotent SQL and SQL file order. The final owner of
  task guard functions and policies must be checked against the current
  company-roles and member-skills chain before implementation.
- Test the routing transitions, multi-team atomic send, role refusals,
  private-draft reads through every relevant query, lead team scoping,
  concurrent changes, QA bug exception, archive behavior and migration.
  Verify in the browser as PM, coordinator, lead, member, QA and stakeholder.
- Roll out in stages that leave existing work usable: request and setup,
  routing/permissions, planner and lead UI, then migration and end-to-end QA.

## Left to the builder

Exact table/function names, component boundaries, notification copy and visual
layout. The implementation plan must inventory every existing task read and
write path before choosing the final schema and migration order.
