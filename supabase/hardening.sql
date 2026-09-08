-- Collabify — upper bounds on what anybody may store.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/hardening.sql

/**
 * Every check in this schema until now was a **minimum**: `length(btrim(x)) > 0`
 * to stop an empty title. Nothing anywhere set a maximum, so a signed-in
 * student could post a fifty-megabyte message body, and a professor a class
 * name of the same size. Row-level security answers "may you", never "how
 * much" — the same gap `rate_limit()` was written to close for "how often".
 *
 * Two halves, and the first is the one that actually bites:
 *
 *   1. **Storage.** Not one bucket had a size limit or a type allowlist. Any
 *      signed-in person could put a file of any size and any kind into the
 *      public `avatars` bucket; the `accept` attribute on the file input is a
 *      hint to the file picker, not a control, and the storage API took
 *      whatever it was sent.
 *
 *      **Measured rather than assumed**, because the result changed the claim
 *      worth making. Supabase serves a public object with its `Content-Type`
 *      and *no* `X-Content-Type-Options: nosniff`. The allowlist added below
 *      rejects an upload whose declared type is not on it — an SVG sent as
 *      `image/svg+xml` comes back `415 invalid_mime_type` — but it reads the
 *      declared header, not the bytes, so the same SVG sent as `image/png` is
 *      still stored. That one is inert: it is then *served* as `image/png`,
 *      which no browser parses as SVG, so it is a broken image and not a
 *      script. What the allowlist buys is that nothing reaches this bucket
 *      labelled as something a browser would execute; what remains is that a
 *      signed-in person can park two megabytes of arbitrary bytes in their own
 *      avatar folder. Closing that would need the bytes checked on the way in,
 *      which is a proxy upload and a great deal more machinery than the risk
 *      is worth.
 *
 *   2. **Text length.** Caps chosen from what the product actually holds: the
 *      longest real value in the database today is a 353-character syllabus
 *      outcome, so these are roughly ten times the observed use rather than
 *      arbitrary round numbers. Long enough never to be met by honest work,
 *      short enough that a loop cannot fill a disk.
 *
 * Caps are `<=`, and none of them is `not null` — an existing null or empty
 * value stays legal, so this file cannot break a row that was already there.
 */

begin;

-- ------------------------------------------------------------------ storage

/**
 * What each bucket accepts.
 *
 * `avatars` is strict because it is the only public one and its purpose is
 * narrow: two formats, two megabytes. Anything that a browser might execute —
 * SVG above all — is simply not storable, which is a stronger guarantee than
 * any header could give and does not depend on Supabase's response headers,
 * which we do not control.
 *
 * `teaching-resources` takes what `parse-syllabus` can actually read. A file
 * it cannot open is a support ticket, not an upload.
 *
 * The four coursework buckets get a **size limit and no type allowlist**, on
 * purpose. Coursework is genuinely any format — a notebook, an archive, a
 * dump, a diagram — and an allowlist there would reject honest work every
 * term. They are private, reached only through a signed URL that expires in
 * ten minutes, so the stored-content risk is a fraction of the public bucket's.
 * If those ever need narrowing, `Content-Disposition: attachment` on download
 * is the better lever than a list of extensions.
 */
update storage.buckets set
  file_size_limit    = 2 * 1024 * 1024,
  allowed_mime_types = array['image/png', 'image/jpeg']
where id = 'avatars';

update storage.buckets set
  file_size_limit    = 20 * 1024 * 1024,
  allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
where id = 'teaching-resources';

update storage.buckets set
  file_size_limit = 25 * 1024 * 1024
where id in ('class-files', 'project-files', 'task-files', 'chat-files');

-- ------------------------------------------------------------- text lengths

/**
 * `add constraint if not exists` does not exist for check constraints, so each
 * one is dropped and recreated. Cheap, and it makes the file re-runnable after
 * a cap is changed.
 */
create or replace function pg_temp.cap(p_table text, p_column text, p_max int)
returns void language plpgsql as $$
declare
  name text := p_table || '_' || p_column || '_max';
begin
  execute format('alter table public.%I drop constraint if exists %I', p_table, name);
  execute format(
    'alter table public.%I add constraint %I check (length(%I) <= %s)',
    p_table, name, p_column, p_max
  );
end;
$$;

-- Names and short labels. A person's name is not 300 characters, and the only
-- thing a longer one achieves is breaking every layout that prints it.
select pg_temp.cap('profiles', 'first_name', 80);
select pg_temp.cap('profiles', 'middle_name', 80);
select pg_temp.cap('profiles', 'last_name', 80);
select pg_temp.cap('profiles', 'email', 254);          -- RFC 5321 maximum
select pg_temp.cap('profiles', 'avatar_url', 500);

select pg_temp.cap('classes', 'name', 120);
select pg_temp.cap('classes', 'initial', 12);
select pg_temp.cap('classes', 'code', 40);
select pg_temp.cap('classes', 'section', 40);
select pg_temp.cap('classes', 'school_year', 20);
select pg_temp.cap('classes', 'description', 2000);

select pg_temp.cap('groups', 'name', 80);
select pg_temp.cap('group_sets', 'name', 80);
select pg_temp.cap('program_sections', 'name', 80);
select pg_temp.cap('program_sections', 'school_year', 20);

-- Bodies. The generous ones, because somebody genuinely writes a long brief.
select pg_temp.cap('announcements', 'title', 200);
select pg_temp.cap('announcements', 'body', 10000);
select pg_temp.cap('program_announcements', 'title', 200);
select pg_temp.cap('program_announcements', 'body', 10000);
select pg_temp.cap('messages', 'body', 5000);
select pg_temp.cap('task_comments', 'body', 5000);
select pg_temp.cap('board_results', 'feedback', 10000);
select pg_temp.cap('task_worklog', 'note', 2000);

select pg_temp.cap('projects', 'title', 200);
select pg_temp.cap('projects', 'guidelines', 20000);
select pg_temp.cap('projects', 'type_label', 60);
select pg_temp.cap('project_criteria', 'label', 200);
select pg_temp.cap('project_criteria', 'description', 2000);
select pg_temp.cap('project_tasks', 'title', 200);
select pg_temp.cap('project_tasks', 'details', 10000);

select pg_temp.cap('task_reassignments', 'reason', 1000);
select pg_temp.cap('task_reassignments', 'decision_note', 1000);
select pg_temp.cap('class_week_shifts', 'reason', 300);

select pg_temp.cap('polls', 'question', 300);
select pg_temp.cap('poll_options', 'label', 120);

select pg_temp.cap('syllabus_weeks', 'title', 200);
select pg_temp.cap('syllabus_weeks', 'topics', 4000);
select pg_temp.cap('syllabus_weeks', 'outcomes', 4000);
select pg_temp.cap('syllabus_weeks', 'assessments', 4000);
select pg_temp.cap('syllabus_weeks', 'notes', 4000);
select pg_temp.cap('teaching_resources', 'title', 200);

select pg_temp.cap('privacy_requests', 'detail', 5000);
select pg_temp.cap('privacy_requests', 'answer', 5000);

/**
 * File names come from the person uploading, so they are user input like any
 * other. 255 is what most filesystems allow, and anything longer arrived from
 * a script rather than a file picker.
 */
select pg_temp.cap('task_files', 'file_name', 255);
select pg_temp.cap('message_attachments', 'file_name', 255);
select pg_temp.cap('announcement_attachments', 'file_name', 255);
select pg_temp.cap('project_attachments', 'file_name', 255);
select pg_temp.cap('teaching_resources', 'file_name', 255);

-- ------------------------------------------------------- remaining throttles

/**
 * `rate-limit.sql` already covers messages, comments, announcements, program
 * notices, class joins, task claims, reassignments, poll votes, projects,
 * teaching resources and every storage bucket. Three writes it does not cover
 * are added here rather than there, so that file stays the record of what
 * shipped with it.
 *
 * The work log is the one that matters: it is the cheapest row in the product
 * to create and the only one a student writes on their own schedule.
 */
create or replace function public.enforce_worklog_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.rate_limit(
    'worklog_entry', 60, interval '1 hour',
    'That is a lot of work log entries in one hour. Wait a while and try again.'
  );
  return new;
end;
$$;

drop trigger if exists task_worklog_rate_limit on public.task_worklog;
create trigger task_worklog_rate_limit before insert on public.task_worklog
  for each row execute function public.enforce_worklog_rate_limit();

create or replace function public.enforce_poll_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.rate_limit(
    'poll_create', 20, interval '1 hour',
    'That is a lot of polls in one hour. Wait a while and try again.'
  );
  return new;
end;
$$;

drop trigger if exists polls_rate_limit on public.polls;
create trigger polls_rate_limit before insert on public.polls
  for each row execute function public.enforce_poll_rate_limit();

create or replace function public.enforce_group_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.rate_limit(
    'group_create', 100, interval '1 hour',
    'That is a lot of groups in one hour. Wait a while and try again.'
  );
  return new;
end;
$$;

-- Generous: a professor splitting a class of sixty into pairs legitimately
-- creates thirty groups in one action, and doing that for two classes back to
-- back must not be refused.
drop trigger if exists groups_rate_limit on public.groups;
create trigger groups_rate_limit before insert on public.groups
  for each row execute function public.enforce_group_rate_limit();

commit;
