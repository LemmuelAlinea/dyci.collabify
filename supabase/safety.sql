-- Collabify — what deleting a person is allowed to take with them.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/safety.sql

/**
 * Nineteen foreign keys cascade from `profiles`. Most of them should: a
 * person's own participation — their claims, their work log, their votes, their
 * messages, their notification settings — has no meaning without the person,
 * and leaving it behind would be worse than removing it.
 *
 * Two of them do not delete the person's own rows. They delete everybody
 * else's.
 *
 *   classes.professor_id   Deleting one professor's row today takes the class,
 *                          its group sets, every project in it, every board,
 *                          every task, every comment, every file and every
 *                          enrolment. On the live database that is 1 class,
 *                          3 projects, 26 tasks and 16 enrolments for one
 *                          DELETE, with no undo and no warning.
 *
 *   projects.created_by    The same shape one level down: delete whoever made a
 *                          project and the project goes, taking all of its
 *                          groups' boards and their work with it.
 *
 * Both become `restrict`. The delete is refused while the work exists, and the
 * program office has to hand the class over or archive it first — which is what
 * anybody would have wanted to happen, and what the Accounts page has always
 * said in words while the database quietly disagreed.
 *
 * This is not theoretical. There is no delete button for a professor in the
 * product, precisely because of this, but the Supabase dashboard has one and so
 * does any stray statement. A constraint holds where a missing button does not.
 *
 * Deliberately left cascading, and why:
 *
 *   task_assignees, task_worklog, poll_votes, message_hidden,
 *   conversation_members, notification_prefs, notifications, class_members,
 *   class_member_archive, group_members, project_boards.student_id
 *       — the person's own participation. It goes with them.
 *
 *   announcements.author_id, messages.sender_id, polls.created_by,
 *   program_announcements.author_id, task_reassignments.requested_by
 *       — things they wrote. Keeping an announcement whose author no longer
 *         exists means a class page with an unattributable notice on it.
 *
 *   teaching_resources.professor_id
 *       — their uploads. A class referencing one loses its syllabus link
 *         (`classes.syllabus_id` is `on delete set null`) but survives, and the
 *         week map can be re-attached. A lesser risk, recorded rather than
 *         changed, because tightening it would block deleting an account that
 *         once uploaded a file and never taught.
 */

begin;

-- A class cannot outlive its professor's account by accident.
alter table public.classes
  drop constraint if exists classes_professor_id_fkey;
alter table public.classes
  add constraint classes_professor_id_fkey
  foreign key (professor_id) references public.profiles (id) on delete restrict;

-- Nor can a project outlive whoever set it.
alter table public.projects
  drop constraint if exists projects_created_by_fkey;
alter table public.projects
  add constraint projects_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete restrict;

commit;
