-- Foreign key indexes.
--
--   node scripts/db.mjs supabase/indexes.sql
--
-- Postgres builds an index for a primary key and for a unique constraint. It
-- builds nothing for a foreign key, which surprises people because the
-- constraint is enforced either way — the index is not about correctness, it
-- is about what the enforcement costs.
--
-- Two things get slow without one, and both get slow suddenly rather than
-- gradually:
--
--   * Deleting or updating the parent row. Postgres has to prove no child
--     references it, and with no index that proof is a sequential scan of the
--     whole child table, once per parent row touched. Archiving a class today
--     reads a handful of rows; at a few thousand messages it reads all of them.
--   * Joining or filtering from the child side, which is most of what the
--     dashboards do.
--
-- The query-pattern indexes were already here and are good — messages by
-- conversation and time, notifications by reader and unread state, task events
-- by task, audit events by subject. What was missing was the plain foreign key
-- coverage underneath them, all 36 of these.
--
-- Written while every table still holds tens of rows, which is the cheap
-- moment: building an index on an empty table is instant and takes no lock
-- worth naming. The same statements against a populated table would want
-- CREATE INDEX CONCURRENTLY and a maintenance window.
--
-- Idempotent, like the rest of the schema. Safe to re-run.

begin;

-- People and accounts ------------------------------------------------------

create index if not exists profiles_decided_by_idx
  on public.profiles (decided_by);

create index if not exists program_sections_adviser_id_idx
  on public.program_sections (adviser_id);

-- Classes and membership ---------------------------------------------------

create index if not exists classes_curriculum_id_idx
  on public.classes (curriculum_id);

create index if not exists classes_syllabus_id_idx
  on public.classes (syllabus_id);

create index if not exists class_members_removed_by_idx
  on public.class_members (removed_by);

create index if not exists class_member_archive_student_id_idx
  on public.class_member_archive (student_id);

-- Groups -------------------------------------------------------------------

create index if not exists group_members_added_by_idx
  on public.group_members (added_by);

-- The one composite here. A two-column foreign key needs a two-column index
-- to be usable for the cascade, and the leading column alone would not serve
-- it — deleting a group set is what walks this.
create index if not exists group_members_group_id_set_id_idx
  on public.group_members (group_id, set_id);

-- Projects and boards ------------------------------------------------------

create index if not exists projects_created_by_idx
  on public.projects (created_by);

create index if not exists projects_group_set_id_idx
  on public.projects (group_set_id);

create index if not exists project_boards_group_id_idx
  on public.project_boards (group_id);

create index if not exists project_boards_student_id_idx
  on public.project_boards (student_id);

create index if not exists project_boards_submitted_by_idx
  on public.project_boards (submitted_by);

create index if not exists board_results_decided_by_idx
  on public.board_results (decided_by);

-- Tasks --------------------------------------------------------------------

create index if not exists project_tasks_created_by_idx
  on public.project_tasks (created_by);

create index if not exists task_assignees_claimed_by_idx
  on public.task_assignees (claimed_by);

create index if not exists task_comments_author_id_idx
  on public.task_comments (author_id);

create index if not exists task_events_actor_id_idx
  on public.task_events (actor_id);

create index if not exists task_files_uploaded_by_idx
  on public.task_files (uploaded_by);

create index if not exists task_worklog_student_id_idx
  on public.task_worklog (student_id);

create index if not exists task_reassignments_decided_by_idx
  on public.task_reassignments (decided_by);

create index if not exists task_reassignments_from_student_idx
  on public.task_reassignments (from_student);

create index if not exists task_reassignments_to_student_idx
  on public.task_reassignments (to_student);

-- Messages and polls -------------------------------------------------------
-- The highest-growth tables in the product: a term of group chat outgrows
-- everything else here put together.

create index if not exists messages_sender_id_idx
  on public.messages (sender_id);

create index if not exists messages_deleted_by_idx
  on public.messages (deleted_by);

create index if not exists message_hidden_user_id_idx
  on public.message_hidden (user_id);

create index if not exists polls_created_by_idx
  on public.polls (created_by);

create index if not exists poll_options_added_by_idx
  on public.poll_options (added_by);

create index if not exists poll_votes_user_id_idx
  on public.poll_votes (user_id);

-- Announcements and notices ------------------------------------------------

create index if not exists announcements_author_id_idx
  on public.announcements (author_id);

create index if not exists program_announcements_author_id_idx
  on public.program_announcements (author_id);

-- Notifications ------------------------------------------------------------
-- Four nullable foreign keys, one per thing a notification can point at. The
-- inbox read is already covered by notifications_inbox_idx; these are for the
-- other direction — deleting a task, class, project or announcement has to
-- clear the notifications that referenced it.

create index if not exists notifications_task_id_idx
  on public.notifications (task_id);

create index if not exists notifications_class_id_idx
  on public.notifications (class_id);

create index if not exists notifications_project_id_idx
  on public.notifications (project_id);

create index if not exists notifications_announcement_id_idx
  on public.notifications (announcement_id);

-- Audit --------------------------------------------------------------------

create index if not exists audit_events_actor_id_idx
  on public.audit_events (actor_id);

commit;

-- Leaves the planner with fresh statistics, so it can start choosing these
-- straight away rather than after the next autovacuum.
analyze;
