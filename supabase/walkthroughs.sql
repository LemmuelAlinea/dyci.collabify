begin;

-- supabase/walkthroughs.sql
-- First-run walkthroughs: one row per person and flow, holding where they stopped.
-- A skipped or done row stays that way; only done_steps keeps changing.
-- Runs after sprint-organization.sql and before anon-lockdown.sql. Idempotent.
--
-- The backfill marks every account that has already signed in as done, so the rollout does
-- not walk existing people through the app. It runs only when the table is first created:
-- a second run would mark accounts that have not met the walkthroughs yet as finished.

do $$
begin
  if to_regclass('public.user_walkthroughs') is null then
    create table public.user_walkthroughs (
      user_id    uuid not null references public.profiles (id) on delete cascade,
      flow       text not null
                   check (flow in ('account', 'teaching', 'project_manager', 'student', 'member')),
      status     text not null default 'active'
                   check (status in ('active', 'paused', 'skipped', 'done')),
      done_steps text[] not null default '{}',
      primary key (user_id, flow)
    );

    insert into public.user_walkthroughs (user_id, flow, status)
    select p.id, f.flow, 'done'
      from public.profiles p
      join auth.users u on u.id = p.id
      cross join lateral (
        select 'account' as flow
        union all select 'student'         where p.role = 'student'
        union all select 'member'          where p.role = 'member'
        union all select 'teaching'        where p.role = 'member' and p.can_teach
        union all select 'project_manager' where p.role = 'member' and p.can_manage_projects
      ) f
     where p.status = 'active'
       and p.role in ('student', 'member')
       and u.last_sign_in_at is not null;
  end if;
end;
$$;

alter table public.user_walkthroughs enable row level security;

drop policy if exists user_walkthroughs_select on public.user_walkthroughs;
create policy user_walkthroughs_select on public.user_walkthroughs
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_walkthroughs_insert on public.user_walkthroughs;
create policy user_walkthroughs_insert on public.user_walkthroughs
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_walkthroughs_update on public.user_walkthroughs;
create policy user_walkthroughs_update on public.user_walkthroughs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The project's default privileges grant delete to authenticated, so revoke it before the grant.
revoke all on public.user_walkthroughs from anon, authenticated, public;
grant select, insert, update on public.user_walkthroughs to authenticated;

create or replace function public.keep_walkthrough_finished()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('skipped', 'done') then
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists user_walkthroughs_keep_finished on public.user_walkthroughs;
create trigger user_walkthroughs_keep_finished
  before update on public.user_walkthroughs
  for each row execute function public.keep_walkthrough_finished();

commit;
