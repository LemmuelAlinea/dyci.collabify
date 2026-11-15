-- supabase/space-look.sql
-- A work space's look: its color and icon, set by the space's project manager
-- in the space's Settings → Details.
--
--   node scripts/db.mjs supabase/space-look.sql supabase/anon-lockdown.sql
--
-- Two optional general_spaces columns from the same sets as a project's look
-- (project-settings-general.sql, src/lib/general/projectLook.ts): color is one
-- of the eight swatches or a lower-case #rrggbb, icon one of the project icons.
-- Null keeps today's look: the plain tile with the space's first letter.
--
-- general_spaces has no update policy, so the one write is set_general_space_look:
-- the space's project manager (its Owner level), on a live work space. A
-- Coordinator changes the name and description but not the look, as on a project.
-- A class's space keeps no look; the class has its own (class-look.sql).
--
-- Read straight from general_spaces (useSpaceLooks), not through
-- general_space_overview, so the view and the files that own it are untouched.
--
-- Runs after organization-settings.sql and before anon-lockdown.sql. Nothing
-- else redefines these columns, constraints or the function. Idempotent.
-- Suite: supabase/tests/space-look.test.sql

begin;

alter table public.general_spaces
  add column if not exists color text,
  add column if not exists icon text;

alter table public.general_spaces drop constraint if exists general_spaces_color_check;
alter table public.general_spaces add constraint general_spaces_color_check
  check (color in ('navy', 'amber', 'green', 'teal', 'violet', 'rose', 'orange', 'slate')
         or color ~ '^#[0-9a-f]{6}$');

alter table public.general_spaces drop constraint if exists general_spaces_icon_check;
alter table public.general_spaces add constraint general_spaces_icon_check
  check (icon in ('monitor', 'board', 'kanban', 'folder', 'book', 'calendar', 'clock',
                  'chart', 'shield', 'palette', 'spark', 'target', 'file', 'message',
                  'users', 'video', 'bell', 'mail', 'pin', 'crown'));

comment on column public.general_spaces.color is
  'The space tile''s color: a project swatch name or #rrggbb. Null is the plain tile.';
comment on column public.general_spaces.icon is
  'The space tile''s icon, from projectLook.ts. Null shows the space''s first letter.';

/**
 * Sets a work space's color and icon; null clears either. Only the space's
 * project manager, and only while the space is live.
 */
create or replace function public.set_general_space_look(p_space uuid, p_color text, p_icon text)
 returns public.general_spaces
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s public.general_spaces%rowtype;
begin
  if public.is_education_space(p_space) then
    raise exception 'A class''s space has no look of its own. Change it in the class''s Settings.'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.general_viewer_active() and public.is_general_space_owner(p_space)) then
    raise exception 'Only the project manager changes the space''s look.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_space_is_archived(p_space) then
    raise exception 'This space is archived. Restore it to change its look.'
      using errcode = 'check_violation';
  end if;

  update public.general_spaces
     set color = nullif(btrim(p_color), ''), icon = nullif(btrim(p_icon), '')
   where id = p_space
  returning * into s;
  return s;
end;
$function$;

revoke all on function public.set_general_space_look(uuid, text, text) from public, anon;
grant execute on function public.set_general_space_look(uuid, text, text) to authenticated, service_role;

commit;
