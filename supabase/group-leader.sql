-- Collabify — one leader per group, picked by the group.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/group-leader.sql
--
-- Who may set it, through `set_group_leader` only:
--   - the class professor, any time the group is live;
--   - a member of the group, while it has no leader;
--   - the current leader, to hand it to another member or step down.
-- So a group picks its own leader once, and after that the leader passes it on
-- or the professor settles it. Nobody else can take it from them.
--
-- Unlike renaming, this stays open after the set is final: a closed set fixes
-- who is in the group, not how the group runs itself.
--
-- The new leader hears about it (`group_leader`), unless they picked
-- themselves. Gated on `project_invites`, the switch for "you have been put
-- into something", beside group_placement.

do $$ begin
  alter type public.notification_type add value if not exists 'group_leader';
exception when undefined_object then null; end $$;

-- A new enum value cannot be used in the same transaction that added it.
begin;

alter table public.groups
  add column if not exists leader_id uuid references public.profiles (id) on delete set null;

-- `group_overview` selects `g.*`, which was expanded when the view was made,
-- so it has to be rebuilt to carry the new column. Same definition as
-- groups.sql.
drop view if exists public.group_overview;

create view public.group_overview
with (security_invoker = true) as
select g.*,
       s.class_id,
       s.name  as set_name,
       s.mode  as set_mode,
       s.closed_at as set_closed_at,
       (select count(*) from public.group_members m where m.group_id = g.id)::int as member_count
  from public.groups g
  join public.group_sets s on s.id = g.set_id;

grant select on public.group_overview to authenticated;

/**
 * `leader_id` moves only through `set_group_leader` and the clean-up below.
 * Members can update their group's row to rename it, and professors can write
 * it freely, so without this either could set any leader — or a non-member —
 * with a plain update.
 */
create or replace function public.guard_group_leader()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null
     or coalesce(current_setting('collabify.group_leader_op', true), 'off') = 'on' then
    return new;
  end if;
  new.leader_id := old.leader_id;
  return new;
end;
$$;

drop trigger if exists groups_guard_leader on public.groups;
create trigger groups_guard_leader before update on public.groups
  for each row execute function public.guard_group_leader();

-- A leader who leaves, is moved or is dropped from the class stops leading.
create or replace function public.clear_group_leader_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('collabify.group_leader_op', 'on', true);
  update public.groups
     set leader_id = null
   where id = old.group_id and leader_id = old.student_id;
  perform set_config('collabify.group_leader_op', 'off', true);
  return old;
end;
$$;

drop trigger if exists group_members_clear_leader on public.group_members;
create trigger group_members_clear_leader after delete on public.group_members
  for each row execute function public.clear_group_leader_on_leave();

/**
 * Make `p_student` the leader of `p_group`, or clear it with null.
 * Raises with a sentence a student can read in a toast.
 */
create or replace function public.set_group_leader(p_group uuid, p_student uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  g          public.groups%rowtype;
  class_gone timestamptz;
  is_prof    boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to choose a group leader.' using errcode = 'insufficient_privilege';
  end if;

  select * into g from public.groups where id = p_group for update;
  if not found then
    raise exception 'That group no longer exists.' using errcode = 'no_data_found';
  end if;

  select c.archived_at into class_gone
    from public.group_sets s join public.classes c on c.id = s.class_id
   where s.id = g.set_id;

  if g.archived_at is not null or class_gone is not null then
    raise exception 'This group is archived. Restore it before changing its leader.'
      using errcode = 'check_violation';
  end if;

  is_prof := public.is_set_professor(g.set_id);

  if not is_prof then
    if not (public.is_group_member(p_group) and public.is_set_class_member(g.set_id)) then
      raise exception 'Only members of this group can choose its leader.'
        using errcode = 'insufficient_privilege';
    end if;
    if g.leader_id is not null and g.leader_id <> auth.uid() then
      raise exception 'Only the current leader or your professor can change the leader.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if p_student is not null and not exists (
    select 1 from public.group_members where group_id = p_group and student_id = p_student
  ) then
    raise exception 'The leader has to be a member of this group.'
      using errcode = 'check_violation';
  end if;

  perform set_config('collabify.group_leader_op', 'on', true);
  update public.groups set leader_id = p_student where id = p_group;
  perform set_config('collabify.group_leader_op', 'off', true);

  if p_student is not null
     and p_student is distinct from g.leader_id
     and p_student <> auth.uid() then
    insert into public.notifications (user_id, type, class_id, group_id, title, preview)
    select p_student, 'group_leader', s.class_id, g.id,
           'You lead ' || g.name,
           coalesce(nullif(trim(p.first_name), ''), 'Someone')
             || ' made you the leader of ' || g.name || ' for ' || c.name || '.'
      from public.group_sets s
      join public.classes c on c.id = s.class_id
      left join public.profiles p on p.id = auth.uid()
     where s.id = g.set_id
       and exists (
         select 1 from public.notification_prefs np
          where np.user_id = p_student and np.project_invites
       );
  end if;
end;
$$;

revoke execute on function public.guard_group_leader() from public, anon;
revoke execute on function public.clear_group_leader_on_leave() from public, anon;
revoke execute on function public.set_group_leader(uuid, uuid) from public, anon;
grant execute on function public.set_group_leader(uuid, uuid) to authenticated;

commit;
