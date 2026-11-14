-- Collabify — office heads: the admin names one head per office.
--
--   node scripts/db.mjs supabase/office-heads.sql supabase/anon-lockdown.sql
--
-- Owns the office_heads table, set_office_head (the admin's setter), the triggers that clear a
-- seat once its head no longer belongs in it, admin_office_heads (the admin's read), the head's
-- own reads (my_headed_office, my_office_overview, my_office_attention, my_office_spaces,
-- my_office_people) and the audit value 'office_head_changed'. Runs after offices.sql and
-- offboarding.sql and before anon-lockdown.sql.
--
-- A head is an active member filed in the office (office_members). The seat lives in its own
-- table rather than a column on offices because every account reads offices; a row here is
-- read only by the admin and the head themself. Only an active admin writes a seat, and only
-- through set_office_head: there is no insert, update or delete policy.
--
-- There is no inactive head. The seat clears itself, with one office_head_changed row whose
-- actor is auth.uid(), through three triggers:
--   - office_members_head_seat_delete: the head's office_members row is deleted. Removal and a
--     role change land here, because profiles_office_role (offices.sql) deletes the row.
--   - office_members_head_seat_move: the head's row moves to another office.
--   - profiles_office_head_status: the head stops being active, deactivated or offboarded.
-- Reactivating does not restore it; the admin names the head again. Archiving an office needs
-- no step of its own: archive_office refuses while active people remain and deletes the
-- inactive ones' rows, which fires the office_members trigger. Deleting a profile cascades
-- office_heads and office_members; depending on cascade order the clear may write no
-- office_head_changed row, which is accepted (profiles are never deleted through the app).
--
-- The head's reads answer only the active head of a live office, and only about that office:
-- names, counts, the quiet date and the no-PM reason, the same figures Admin Home shows the
-- admin, never project content. They count exactly as admin_org_overview does, and the suite
-- pins that. Everyone else, the admin and other heads included, gets zero rows.
--
-- Additive: nothing an earlier file owns is redefined; the seat triggers are separate triggers.
--
-- Idempotent. Safe to re-run.

-- A new enum value cannot be used in the transaction that adds it, so it commits first.
begin;

do $$
begin
  alter type public.audit_action add value if not exists 'office_head_changed';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- table

/** One row per office that has a head. The key keeps it to one head per office. */
create table if not exists public.office_heads (
  office_id   uuid primary key references public.offices (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now()
);

-- A person is filed in one office, so they head one at most.
create unique index if not exists office_heads_one_per_person on public.office_heads (user_id);

alter table public.office_heads enable row level security;

revoke all on public.office_heads from public, anon, authenticated;
grant select on public.office_heads to authenticated;

drop policy if exists office_heads_select on public.office_heads;
create policy office_heads_select on public.office_heads
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------- setter

/**
 * The office's head; null clears the seat. The office is live, and the head an active member
 * filed in it. Setting the head the seat already has writes nothing.
 */
create or replace function public.set_office_head(p_office uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o        public.offices%rowtype;
  v_before uuid;
begin
  perform public.require_office_admin();

  select * into o from public.offices where id = p_office for update;
  if o.id is null then
    raise exception 'That office no longer exists. Refresh the page.';
  end if;
  if o.archived_at is not null then
    raise exception 'This office is archived. Restore it first.'
      using errcode = 'check_violation';
  end if;

  -- Locks the person and their office row, so a move or a deactivation waits for this seat
  -- and then clears it.
  if p_user is not null then
    perform 1
      from public.profiles p
      join public.office_members m on m.user_id = p.id
     where p.id = p_user and p.role = 'member' and p.status = 'active'
       and m.office_id = p_office
       for share of p, m;
    if not found then
      raise exception 'Only an active member of this office can head it. Choose someone else.'
        using errcode = 'check_violation';
    end if;
  end if;

  select user_id into v_before from public.office_heads where office_id = p_office for update;
  if v_before is not distinct from p_user then
    return; -- already so
  end if;

  if p_user is null then
    delete from public.office_heads where office_id = p_office;
  else
    insert into public.office_heads (office_id, user_id, assigned_by)
    values (p_office, p_user, auth.uid())
    on conflict (office_id) do update
      set user_id = excluded.user_id, assigned_by = excluded.assigned_by, assigned_at = now();
  end if;

  insert into public.audit_events
    (action, actor_id, subject_id, subject_label, before_value, after_value)
  values ('office_head_changed', auth.uid(), o.id, o.name,
          coalesce(public.audit_label(v_before), ''), coalesce(public.audit_label(p_user), ''));
end;
$$;

-- ---------------------------------------------------------------- the seat clears itself

/** Clears the seat this person heads, if any, and logs it. Internal. */
create or replace function public.office_head_clear(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  with gone as (
    delete from public.office_heads where user_id = p_user returning office_id, user_id
  )
  insert into public.audit_events
    (action, actor_id, subject_id, subject_label, before_value, after_value)
  select 'office_head_changed', auth.uid(), gone.office_id, coalesce(o.name, ''),
         coalesce(public.audit_label(gone.user_id), ''), ''
    from gone left join public.offices o on o.id = gone.office_id;
end;
$$;

/** A head who moves to another office, or loses theirs, leaves the seat. */
create or replace function public.office_members_head_seat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or new.office_id is distinct from old.office_id then
    -- Only the seat of the office they left: they cannot head the one they moved to yet.
    if exists (select 1 from public.office_heads
                where user_id = old.user_id and office_id = old.office_id) then
      perform public.office_head_clear(old.user_id);
    end if;
  end if;
  return null;
end;
$$;

-- Two triggers, because a delete trigger's WHEN cannot read new.
drop trigger if exists office_members_head_seat on public.office_members;
drop trigger if exists office_members_head_seat_delete on public.office_members;
drop trigger if exists office_members_head_seat_move on public.office_members;
create trigger office_members_head_seat_delete after delete on public.office_members
  for each row execute function public.office_members_head_seat();
create trigger office_members_head_seat_move after update of office_id on public.office_members
  for each row when (old.office_id is distinct from new.office_id)
  execute function public.office_members_head_seat();

/** A head who stops being active (deactivated or offboarded) leaves the seat. */
create or replace function public.profiles_office_head_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'active' and new.status is distinct from 'active' then
    perform public.office_head_clear(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_office_head_status on public.profiles;
create trigger profiles_office_head_status after update of status on public.profiles
  for each row when (old.status = 'active' and new.status is distinct from 'active')
  execute function public.profiles_office_head_status();

-- ---------------------------------------------------------------- admin read

/** Every office's head, for the Offices page and Admin Home. Nothing to anyone else. */
create or replace function public.admin_office_heads()
returns table (office_id uuid, head_id uuid, head_name text)
language sql stable security definer set search_path = public as $$
  select h.office_id,
         h.user_id,
         coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email)
    from public.office_heads h
    join public.profiles p on p.id = h.user_id
   where public.office_admin_reads()
   order by h.office_id;
$$;

-- ---------------------------------------------------------------- the head's reads
--
-- Each counts as admin_org_overview counts for one office: live work spaces filed in it, the
-- projects running in them (office_running_projects), active members filed in it, and the
-- rows of office_attention_rows for it.

/**
 * The office the caller heads, or null: an office_heads row for auth.uid() on a live office,
 * whose head is an active member still filed in it. The gate for every read below. Internal.
 */
create or replace function public.office_head_of_caller()
returns uuid language sql stable security definer set search_path = public as $$
  select h.office_id
    from public.office_heads h
    join public.offices o on o.id = h.office_id and o.archived_at is null
    join public.profiles p on p.id = h.user_id and p.role = 'member' and p.status = 'active'
    join public.office_members m on m.user_id = h.user_id and m.office_id = h.office_id
   where h.user_id = auth.uid();
$$;

/** The office the caller heads, for the rail and the My office banner. */
create or replace function public.my_headed_office()
returns table (office_id uuid, office_name text)
language sql stable security definer set search_path = public as $$
  with me as (select public.office_head_of_caller() as id)
  select o.id, o.name
    from me
    join public.offices o on o.id = me.id;
$$;

/** The office's figures: that office's admin_org_overview row, without the office. */
create or replace function public.my_office_overview()
returns table (spaces int, running_projects int, people int, needs_attention int)
language sql stable security definer set search_path = public as $$
  select (select count(*)
            from public.general_spaces s
            join public.office_spaces os on os.space_id = s.id
           where os.office_id = me.id
             and s.kind = 'work' and s.archived_at is null and s.trashed_at is null)::int,
         (select count(*)
            from public.office_running_projects() r
            join public.office_spaces os on os.space_id = r.space_id
           where os.office_id = me.id)::int,
         (select count(*)
            from public.profiles p
            join public.office_members m on m.user_id = p.id
           where m.office_id = me.id and p.role = 'member' and p.status = 'active')::int,
         (select count(*)
            from public.office_attention_rows() a
           where a.office_id = me.id)::int
    from (select public.office_head_of_caller() as id) me
   where me.id is not null;
$$;

/**
 * The office's running projects that need attention: no PM first, then the longest quiet.
 * i_am_on: the caller has a general_members row on it (any role), so the page links only those.
 */
create or replace function public.my_office_attention()
returns table (project_id uuid, project_name text, space_name text, no_pm boolean,
               quiet_since timestamptz, i_am_on boolean)
language sql stable security definer set search_path = public as $$
  with me as (select public.office_head_of_caller() as id)
  select a.project_id,
         a.project_name,
         a.space_name,
         a.no_pm,
         a.quiet_since,
         exists (select 1 from public.general_members gm
                  where gm.project_id = a.project_id and gm.user_id = auth.uid())
    from me
    join public.office_attention_rows() a on a.office_id = me.id
   order by a.no_pm desc, a.quiet_since asc nulls last, lower(a.project_name), a.project_id;
$$;

/** The office's live work spaces, with how many projects run in each. */
create or replace function public.my_office_spaces()
returns table (space_id uuid, space_name text, running_projects int)
language sql stable security definer set search_path = public as $$
  with me as (select public.office_head_of_caller() as id)
  select s.id,
         s.name,
         coalesce(rp.n, 0)::int
    from me
    join public.office_spaces os on os.office_id = me.id
    join public.general_spaces s on s.id = os.space_id
    left join (select r.space_id, count(*) as n
                 from public.office_running_projects() r
                group by r.space_id) rp on rp.space_id = s.id
   where s.kind = 'work' and s.archived_at is null and s.trashed_at is null
   order by lower(s.name), s.id;
$$;

/** The office's active members, by name. */
create or replace function public.my_office_people()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  with me as (select public.office_head_of_caller() as id)
  select p.id,
         coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email)
    from me
    join public.office_members m on m.office_id = me.id
    join public.profiles p on p.id = m.user_id
   where p.role = 'member' and p.status = 'active'
   order by p.last_name, p.first_name, p.id;
$$;

-- ---------------------------------------------------------------- grants

-- Internal helpers and trigger functions: nobody calls them directly.
revoke all on function public.office_head_of_caller() from public, anon, authenticated;
revoke all on function public.office_head_clear(uuid) from public, anon, authenticated;
revoke all on function public.office_members_head_seat() from public, anon, authenticated;
revoke all on function public.profiles_office_head_status() from public, anon, authenticated;

revoke all on function public.set_office_head(uuid, uuid) from public, anon;
revoke all on function public.admin_office_heads() from public, anon;
grant execute on function public.set_office_head(uuid, uuid) to authenticated;
grant execute on function public.admin_office_heads() to authenticated;

-- The head's reads. Anyone signed in may call them; only an active head gets rows.
revoke all on function public.my_headed_office() from public, anon;
revoke all on function public.my_office_overview() from public, anon;
revoke all on function public.my_office_attention() from public, anon;
revoke all on function public.my_office_spaces() from public, anon;
revoke all on function public.my_office_people() from public, anon;
grant execute on function public.my_headed_office() to authenticated;
grant execute on function public.my_office_overview() to authenticated;
grant execute on function public.my_office_attention() to authenticated;
grant execute on function public.my_office_spaces() to authenticated;
grant execute on function public.my_office_people() to authenticated;

commit;
