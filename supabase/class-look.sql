-- supabase/class-look.sql
-- A class's look: its color and icon, set in the class's Settings → General.
--
--   node scripts/db.mjs supabase/class-look.sql supabase/anon-lockdown.sql
--
-- Two optional classes columns, written through the existing classes_update
-- policy (the class professor, or a co-teacher who teaches in its space), so
-- students never write them. color is one of the eight project swatches or a
-- lower-case #rrggbb; icon is one of the class icons in src/lib/classLook.ts.
-- Null keeps today's look: no color, and the class initials on the tile.
--
-- Read straight from classes (useClassLooks), not through class_overview, so
-- the view and the files that own it are untouched.
--
-- Runs after class-files-teacher-read.sql and before anon-lockdown.sql. Nothing
-- else redefines these columns or constraints. Idempotent.
-- Suite: supabase/tests/class-look.test.sql

begin;

alter table public.classes
  add column if not exists color text,
  add column if not exists icon text;

alter table public.classes drop constraint if exists classes_color_check;
alter table public.classes add constraint classes_color_check
  check (color in ('navy', 'amber', 'green', 'teal', 'violet', 'rose', 'orange', 'slate')
         or color ~ '^#[0-9a-f]{6}$');

alter table public.classes drop constraint if exists classes_icon_check;
alter table public.classes add constraint classes_icon_check
  check (icon in ('school', 'code', 'database', 'network', 'server', 'cpu', 'terminal', 'globe',
                  'mobile', 'cloud', 'shield', 'brain', 'chart', 'math', 'flask', 'book', 'pen',
                  'language', 'palette', 'briefcase', 'presentation', 'users', 'certificate'));

comment on column public.classes.color is
  'The class tile''s color: a project swatch name or #rrggbb. Null is the plain tile.';
comment on column public.classes.icon is
  'The class tile''s icon, from classLook.ts. Null shows the class initials.';

commit;
