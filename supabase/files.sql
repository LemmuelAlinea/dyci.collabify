-- Collabify — every file, under the class it belongs to.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/files.sql

/**
 * Files live in four places and were reachable from none of them at once: a
 * task attachment only from the task it hangs off, a syllabus only from the
 * Syllabi page, project material only from the brief. A professor with a group
 * that has just handed in had no way to see what they handed in without
 * opening every task in turn.
 *
 * This gathers them without moving any of them. Nothing is copied, no bucket
 * changes, and every row still lives exactly where its own policies say it
 * does — `security_invoker` means a student reaches their own board's files and
 * a professor reaches their classes', with nothing about roles written here.
 *
 * `bucket` travels with each row because the four stores are four buckets, and
 * a signed URL has to be asked of the right one.
 */

begin;

drop view if exists public.file_overview;

create view public.file_overview
with (security_invoker = true) as

-- What a group or a student attached to a task. The deliverable itself.
select 'task'                    as source,
       f.id,
       f.file_name,
       f.file_path,
       'task-files'              as bucket,
       f.mime_type,
       f.size_bytes,
       f.created_at              as uploaded_at,
       f.uploaded_by,
       btrim(up.first_name || ' ' || up.last_name) as uploaded_by_name,
       p.class_id,
       c.initial                 as class_initial,
       c.name                    as class_name,
       p.id                      as project_id,
       p.title                   as project_title,
       p.audience                as project_audience,
       b.id                      as board_id,
       b.group_id,
       g.name                    as group_name,
       b.student_id,
       btrim(sp.first_name || ' ' || sp.last_name) as student_name,
       t.id                      as task_id,
       t.title                   as task_title
  from public.task_files f
  join public.project_tasks t   on t.id = f.task_id
  join public.project_boards b  on b.id = t.board_id
  join public.projects p        on p.id = b.project_id
  join public.classes c         on c.id = p.class_id
  left join public.groups g     on g.id = b.group_id
  left join public.profiles sp  on sp.id = b.student_id
  left join public.profiles up  on up.id = f.uploaded_by

union all

-- What the professor handed out with the brief.
select 'project',
       a.id,
       a.file_name,
       a.file_path,
       'project-files',
       a.mime_type,
       a.size_bytes,
       a.created_at,
       p.created_by,
       btrim(pp.first_name || ' ' || pp.last_name),
       p.class_id,
       c.initial,
       c.name,
       p.id,
       p.title,
       p.audience,
       null::uuid, null::uuid, null::text, null::uuid, null::text,
       null::uuid, null::text
  from public.project_attachments a
  join public.projects p on p.id = a.project_id
  join public.classes c  on c.id = p.class_id
  left join public.profiles pp on pp.id = p.created_by

union all

-- The syllabus and the curriculum the class is built on. A class points at one
-- of each, so they are joined per class rather than listed once per professor.
select case when r.id = c.syllabus_id then 'syllabus' else 'curriculum' end,
       r.id,
       r.file_name,
       r.title,
       'teaching-resources',
       null::text,
       r.size_bytes,
       r.uploaded_at,
       r.professor_id,
       btrim(rp.first_name || ' ' || rp.last_name),
       c.id,
       c.initial,
       c.name,
       null::uuid, null::text, null::public.project_audience,
       null::uuid, null::uuid, null::text, null::uuid, null::text,
       null::uuid, null::text
  from public.classes c
  join public.teaching_resources r
    on r.id = c.syllabus_id or r.id = c.curriculum_id
  left join public.profiles rp on rp.id = r.professor_id;

grant select on public.file_overview to authenticated;

commit;
