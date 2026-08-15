-- Collabify — groups: named group sets per class, three grouping modes, rosters.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/groups.sql

begin;

-- ---------------------------------------------------------------- enums

do $$ begin
  create type public.grouping_mode as enum ('manual', 'random', 'student_formed');
exception when duplicate_object then null; end $$;

-- notifications was built generic in classes.sql; extend it rather than add a table.
do $$ begin
  alter type public.notification_type add value if not exists 'group_placement';
exception when undefined_object then null; end $$;

do $$ begin
  alter type public.notification_type add value if not exists 'group_closed';
exception when undefined_object then null; end $$;

commit;

-- New enum values cannot be used in the same transaction that adds them.
begin;

alter table public.notifications
  add column if not exists group_id uuid;

-- ---------------------------------------------------------------- tables

create table if not exists public.group_sets (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes (id) on delete cascade,
  name          text not null,
  mode          public.grouping_mode not null,
  default_limit int not null default 5,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint group_sets_limit_sane check (default_limit between 1 and 50)
);

create index if not exists group_sets_class_idx on public.group_sets (class_id, created_at desc);

create table if not exists public.groups (
  id           uuid primary key default gen_random_uuid(),
  set_id       uuid not null references public.group_sets (id) on delete cascade,
  name         text not null,
  member_limit int not null default 5,
  position     int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint groups_limit_sane check (member_limit between 1 and 50),
  -- Lets group_members carry set_id and stay provably consistent with the group.
  constraint groups_id_set_key unique (id, set_id)
);

create index if not exists groups_set_idx on public.groups (set_id, position);

create table if not exists public.group_members (
  group_id   uuid not null,
  set_id     uuid not null,
  student_id uuid not null references public.profiles (id) on delete cascade,
  added_by   uuid references public.profiles (id) on delete set null,
  joined_at  timestamptz not null default now(),
  primary key (group_id, student_id),
  foreign key (group_id, set_id) references public.groups (id, set_id) on delete cascade,
  -- One group per student per set. This is what makes switching a move rather
  -- than a duplicate.
  constraint group_members_one_per_set unique (set_id, student_id)
);

create index if not exists group_members_student_idx on public.group_members (student_id);

drop trigger if exists group_sets_touch on public.group_sets;
create trigger group_sets_touch before update on public.group_sets
  for each row execute function public.touch_updated_at();

drop trigger if exists groups_touch on public.groups;
create trigger groups_touch before update on public.groups
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- helpers

create or replace function public.is_set_professor(p_set uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_sets s
      join public.classes c on c.id = s.class_id
     where s.id = p_set and c.professor_id = auth.uid()
  );
$$;

create or replace function public.is_set_class_member(p_set uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_sets s
      join public.class_members m on m.class_id = s.class_id
     where s.id = p_set and m.student_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
     where group_id = p_group and student_id = auth.uid()
  );
$$;

-- Students may browse the whole set only while they still have a choice to
-- make: a student-formed set that is still open. In a manual or random set,
-- and in any closed set, a student sees their own group and nothing else.
create or replace function public.is_set_browsable(p_set uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_sets
     where id = p_set and mode = 'student_formed' and closed_at is null
  );
$$;

-- A student renaming their group must not also raise its member limit.
create or replace function public.guard_group_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;
  if not public.is_set_professor(new.set_id) then
    new.set_id       := old.set_id;
    new.member_limit := old.member_limit;
    new.position     := old.position;
  end if;
  return new;
end;
$$;

drop trigger if exists groups_guard_columns on public.groups;
create trigger groups_guard_columns before update on public.groups
  for each row execute function public.guard_group_columns();

-- Dropping a student from a class must not leave them on a group roster.
create or replace function public.drop_group_memberships_on_class_removal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'removed' and old.status is distinct from 'removed' then
    delete from public.group_members gm
      using public.group_sets s
     where gm.set_id = s.id
       and s.class_id = new.class_id
       and gm.student_id = new.student_id;
  end if;
  return new;
end;
$$;

drop trigger if exists class_members_drop_groups on public.class_members;
create trigger class_members_drop_groups after update on public.class_members
  for each row execute function public.drop_group_memberships_on_class_removal();

-- ---------------------------------------------------------------- notifications

create or replace function public.notify_group_placement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  info record;
begin
  -- Self-joins need no notification; the student just did it.
  if new.added_by is null or new.added_by = new.student_id then
    return new;
  end if;

  select g.name as group_name, c.name as class_name, s.class_id
    into info
    from public.groups g
    join public.group_sets s on s.id = g.set_id
    join public.classes c on c.id = s.class_id
   where g.id = new.group_id;

  insert into public.notifications (user_id, type, class_id, group_id, title, preview)
  select new.student_id, 'group_placement', info.class_id, new.group_id,
         'Added to ' || info.group_name,
         'You were placed in ' || info.group_name || ' for ' || info.class_name || '.'
   where exists (
     select 1 from public.notification_prefs np
      where np.user_id = new.student_id and np.project_invites
   );
  return new;
end;
$$;

drop trigger if exists group_members_notify on public.group_members;
create trigger group_members_notify after insert on public.group_members
  for each row execute function public.notify_group_placement();

create or replace function public.notify_group_closed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  class_name text;
begin
  if new.closed_at is null or old.closed_at is not null then
    return new;
  end if;

  select c.name into class_name from public.classes c where c.id = new.class_id;

  insert into public.notifications (user_id, type, class_id, group_id, title, preview)
  select gm.student_id, 'group_closed', new.class_id, gm.group_id,
         new.name || ' is final',
         'Your group for ' || class_name || ' is now final.'
    from public.group_members gm
    join public.notification_prefs np on np.user_id = gm.student_id
   where gm.set_id = new.id and np.project_invites;
  return new;
end;
$$;

drop trigger if exists group_sets_notify_closed on public.group_sets;
create trigger group_sets_notify_closed after update on public.group_sets
  for each row execute function public.notify_group_closed();

-- ---------------------------------------------------------------- RPCs

-- Students never insert into group_members directly. This is the only way in,
-- and it moves a student who is already in another group of the same set.
create or replace function public.join_group(p_group uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  g      public.groups%rowtype;
  s      public.group_sets%rowtype;
  taken  int;
begin
  if auth.uid() is null then
    return jsonb_build_object('result', 'not_signed_in');
  end if;

  select * into g from public.groups where id = p_group;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into s from public.group_sets where id = g.set_id;

  if not public.is_set_class_member(s.id) then
    return jsonb_build_object('result', 'not_in_class');
  end if;
  if s.closed_at is not null then
    return jsonb_build_object('result', 'closed');
  end if;
  if s.mode <> 'student_formed' then
    return jsonb_build_object('result', 'not_student_formed');
  end if;
  if exists (select 1 from public.group_members
              where group_id = p_group and student_id = auth.uid()) then
    return jsonb_build_object('result', 'already_here', 'group_id', p_group);
  end if;

  select count(*) into taken from public.group_members where group_id = p_group;
  if taken >= g.member_limit then
    return jsonb_build_object('result', 'full');
  end if;

  -- Switching: leave whatever group in this set they are in, then join.
  delete from public.group_members
   where set_id = s.id and student_id = auth.uid();

  insert into public.group_members (group_id, set_id, student_id, added_by)
  values (p_group, s.id, auth.uid(), auth.uid());

  return jsonb_build_object('result', 'joined', 'group_id', p_group);
end;
$$;

create or replace function public.leave_group(p_group uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s public.group_sets%rowtype;
begin
  select gs.* into s
    from public.group_sets gs
    join public.groups g on g.set_id = gs.id
   where g.id = p_group;

  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if s.closed_at is not null then
    return jsonb_build_object('result', 'closed');
  end if;
  if s.mode <> 'student_formed' then
    return jsonb_build_object('result', 'not_student_formed');
  end if;

  delete from public.group_members
   where group_id = p_group and student_id = auth.uid();

  return jsonb_build_object('result', 'left');
end;
$$;

-- One transactional write for the manual and random bulk saves, so a
-- half-built arrangement can never land.
--   payload: [{ "name": "Group 1", "member_limit": 5, "students": ["uuid", ...] }, ...]
create or replace function public.save_group_arrangement(p_set uuid, p_groups jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  item     jsonb;
  new_id   uuid;
  idx      int := 0;
  made     int := 0;
  s        public.group_sets%rowtype;
begin
  if not public.is_set_professor(p_set) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  select * into s from public.group_sets where id = p_set;
  if s.closed_at is not null then
    return jsonb_build_object('result', 'closed');
  end if;

  delete from public.groups where set_id = p_set;

  for item in select * from jsonb_array_elements(p_groups) loop
    idx := idx + 1;
    insert into public.groups (set_id, name, member_limit, position)
    values (
      p_set,
      coalesce(nullif(item ->> 'name', ''), 'Group ' || idx),
      coalesce((item ->> 'member_limit')::int, s.default_limit),
      idx
    )
    returning id into new_id;

    insert into public.group_members (group_id, set_id, student_id, added_by)
    select new_id, p_set, (value #>> '{}')::uuid, auth.uid()
      from jsonb_array_elements(coalesce(item -> 'students', '[]'::jsonb));

    made := made + 1;
  end loop;

  return jsonb_build_object('result', 'saved', 'groups', made);
end;
$$;

-- Who in the class has no group in this set — powers the close confirmation.
create or replace function public.ungrouped_students(p_set uuid)
returns table (student_id uuid, first_name text, last_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name
    from public.group_sets s
    join public.class_members m on m.class_id = s.class_id and m.status = 'active'
    join public.profiles p on p.id = m.student_id
   where s.id = p_set
     and (public.is_set_professor(p_set) or public.is_set_class_member(p_set))
     and not exists (
       select 1 from public.group_members gm
        where gm.set_id = p_set and gm.student_id = m.student_id
     )
   order by p.last_name, p.first_name;
$$;

revoke all on function public.join_group(uuid) from public;
revoke all on function public.leave_group(uuid) from public;
revoke all on function public.save_group_arrangement(uuid, jsonb) from public;
revoke all on function public.ungrouped_students(uuid) from public;
grant execute on function public.join_group(uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.save_group_arrangement(uuid, jsonb) to authenticated;
grant execute on function public.ungrouped_students(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.group_sets    enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

drop policy if exists group_sets_select on public.group_sets;
create policy group_sets_select on public.group_sets
  for select using (
    public.is_class_professor(class_id)
    or (
      public.is_active_member(class_id)
      and exists (select 1 from public.classes c where c.id = class_id and c.archived_at is null)
    )
  );

drop policy if exists group_sets_write on public.group_sets;
create policy group_sets_write on public.group_sets
  for all using (public.is_class_professor(class_id))
  with check (public.is_class_professor(class_id));

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups
  for select using (
    public.is_set_professor(set_id)
    or (
      public.is_set_class_member(set_id)
      and (public.is_group_member(id) or public.is_set_browsable(set_id))
    )
  );

drop policy if exists groups_write on public.groups;
create policy groups_write on public.groups
  for all using (public.is_set_professor(set_id))
  with check (public.is_set_professor(set_id));

-- Members may update a group so they can rename it; guard_group_columns()
-- reverts anything other than the name.
drop policy if exists groups_rename_by_member on public.groups;
create policy groups_rename_by_member on public.groups
  for update using (
    public.is_group_member(id)
    and exists (select 1 from public.group_sets s where s.id = set_id and s.closed_at is null)
  )
  with check (public.is_group_member(id));

drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members
  for select using (
    student_id = auth.uid()
    or public.is_set_professor(set_id)
    or (
      public.is_set_class_member(set_id)
      and (public.is_group_member(group_id) or public.is_set_browsable(set_id))
    )
  );

drop policy if exists group_members_write on public.group_members;
create policy group_members_write on public.group_members
  for all using (public.is_set_professor(set_id))
  with check (public.is_set_professor(set_id));

-- ---------------------------------------------------------------- views

create or replace view public.group_overview
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

commit;
