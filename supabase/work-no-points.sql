-- Collabify — work tasks carry no points.
--
--   node scripts/db.mjs supabase/work-no-points.sql
--
-- Points belong to Education boards. A work project's progress counts every
-- task the same, so the project setting is switched off everywhere and the
-- app no longer offers it. `general_tasks.weight` stays in place (default 1)
-- and is simply not read while the setting is off.
--
-- Safe to re-run. Requires supabase/general.sql.

update public.general_projects
   set points_enabled = false
 where points_enabled;
