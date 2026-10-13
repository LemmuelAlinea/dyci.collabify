-- Collabify — the intervention log, with names, for reports.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/report-notes.sql
-- Requires: class-notes.sql. Re-run supabase/anon-lockdown.sql afterwards.

/**
 * class_notes holds ids. A printed log needs who the note is about, which
 * group and project, and who wrote it. Staff only (class_notes' own policy
 * still applies through security_invoker), and ended classes stay in: a log
 * is read after the term, for accreditation.
 */

begin;

drop view if exists public.class_note_log;

create view public.class_note_log
with (security_invoker = true) as
select n.id, n.class_id, n.student_id, n.board_id, n.kind, n.body, n.follow_up_on,
       n.resolved_at, n.outcome, n.created_by, n.created_at,
       nullif(btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), '') as student_name,
       coalesce(g.name, nullif(btrim(coalesce(bs.first_name, '') || ' ' || coalesce(bs.last_name, '')), '')) as group_name,
       p.title as project_title,
       nullif(btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), '') as author_name
  from public.class_notes n
  left join public.profiles s on s.id = n.student_id
  left join public.project_boards b on b.id = n.board_id
  left join public.groups g on g.id = b.group_id
  left join public.profiles bs on bs.id = b.student_id
  left join public.projects p on p.id = b.project_id
  left join public.profiles a on a.id = n.created_by
 where public.is_class_professor(n.class_id);

revoke all on public.class_note_log from anon;
grant select on public.class_note_log to authenticated;

commit;
