-- Collabify — links to a class, a class project or a professor task inside an announcement.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/announcement-links.sql

/**
 * A professor can point an announcement at the work it is about, so a student
 * clicks straight through instead of hunting for it. Links are in-app only:
 * each one names a kind and an id, and the page builds the route. There is no
 * free URL to slip something else in.
 *
 *   { "kind": "class",   "id": <class id>,  "label": "..." }
 *   { "kind": "project", "id": <project id>, "label": "..." }
 *   { "kind": "task",    "id": <origin id>, "project_id": <project id>, "label": "..." }
 *
 * A task link names a professor task by its origin, not one group's copy, so
 * each student lands on their own group's copy. The trigger refuses a class
 * the author does not teach, and a project or task from another class. The
 * label is a snapshot for display; what a student can open is still decided by
 * the page they land on.
 */

begin;

alter table public.announcements
  add column if not exists links jsonb not null default '[]'::jsonb;

alter table public.announcements drop constraint if exists announcements_links_shape;
alter table public.announcements
  add constraint announcements_links_shape
  check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 8);

create or replace function public.guard_announcement_links()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  l      jsonb;
  kind   text;
  target uuid;
  proj   uuid;
  label  text;
begin
  if tg_op = 'UPDATE' and new.links is not distinct from old.links then
    return new;
  end if;
  if auth.uid() is null then
    return new; -- service role
  end if;

  for l in select value from jsonb_array_elements(new.links) loop
    if jsonb_typeof(l) <> 'object' then
      raise exception 'That link is not valid. Remove it and add it again.' using errcode = 'check_violation';
    end if;
    kind  := l ->> 'kind';
    label := btrim(coalesce(l ->> 'label', ''));
    if char_length(label) not between 1 and 200 then
      raise exception 'Each link needs a name of up to 200 characters.' using errcode = 'check_violation';
    end if;
    begin
      target := (l ->> 'id')::uuid;
      proj   := nullif(l ->> 'project_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'That link is not valid. Remove it and add it again.' using errcode = 'check_violation';
    end;
    if target is null then
      raise exception 'That link is not valid. Remove it and add it again.' using errcode = 'check_violation';
    end if;

    if kind = 'class' then
      if not public.is_class_professor(target) then
        raise exception 'You can only link a class you teach.' using errcode = 'insufficient_privilege';
      end if;
    elsif kind = 'project' then
      if not exists (select 1 from public.projects p where p.id = target and p.class_id = new.class_id) then
        raise exception 'That project is not in this class.' using errcode = 'check_violation';
      end if;
    elsif kind = 'task' then
      if proj is null or not exists (
        select 1
          from public.project_tasks t
          join public.project_boards b on b.id = t.board_id
          join public.projects p on p.id = b.project_id
         where t.origin_id = target and p.id = proj and p.class_id = new.class_id
      ) then
        raise exception 'That task is not in this class.' using errcode = 'check_violation';
      end if;
    else
      raise exception 'That link is not valid. Remove it and add it again.' using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function public.guard_announcement_links() from public, anon;

drop trigger if exists announcements_guard_links on public.announcements;
create trigger announcements_guard_links
  before insert or update of links on public.announcements
  for each row execute function public.guard_announcement_links();

commit;
