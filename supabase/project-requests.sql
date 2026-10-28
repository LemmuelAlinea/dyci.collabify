-- Private project requests in work Spaces. Authors and Space Owners/Managers
-- discuss the brief before a project exists. Conversion is defined later here.
-- Re-run after the current company-role chain, then anon-lockdown.sql.
-- Idempotent.

begin;

create table if not exists public.general_project_requests (
  id                   uuid primary key default gen_random_uuid(),
  space_id             uuid not null references public.general_spaces (id) on delete cascade,
  author_id            uuid references public.profiles (id) on delete set null,
  title                text not null,
  brief                text not null,
  desired_outcome      text not null,
  target_date          date,
  status               text not null default 'open',
  converted_project_id uuid references public.general_projects (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint general_project_requests_title check (char_length(btrim(title)) between 1 and 200),
  constraint general_project_requests_brief check (char_length(btrim(brief)) between 1 and 20000),
  constraint general_project_requests_outcome check (char_length(btrim(desired_outcome)) between 1 and 2000),
  constraint general_project_requests_status check (status in ('open', 'ready', 'converted', 'closed'))
);

create index if not exists general_project_requests_space_idx
  on public.general_project_requests (space_id, created_at desc);
create unique index if not exists general_project_requests_converted_idx
  on public.general_project_requests (converted_project_id) where converted_project_id is not null;

drop trigger if exists general_project_requests_touch on public.general_project_requests;
create trigger general_project_requests_touch before update on public.general_project_requests
  for each row execute function public.touch_updated_at();

create table if not exists public.general_project_request_messages (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.general_project_requests (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint general_project_request_messages_body check (char_length(btrim(body)) between 1 and 5000)
);

create index if not exists general_project_request_messages_request_idx
  on public.general_project_request_messages (request_id, created_at);

alter table public.general_project_requests enable row level security;
alter table public.general_project_request_messages enable row level security;

-- Security definer avoids a policy recursively querying its own table.
create or replace function public.general_project_request_reader(p_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.general_project_requests r
      join public.general_spaces s on s.id = r.space_id and s.kind = 'work'
      join public.general_space_members m on m.space_id = r.space_id and m.user_id = auth.uid()
      join public.profiles p on p.id = m.user_id and p.status = 'active'
     where r.id = p_request
       and (r.author_id = auth.uid() or m.level in ('owner', 'manager'))
  );
$$;

drop policy if exists general_project_requests_select on public.general_project_requests;
create policy general_project_requests_select on public.general_project_requests
  for select to authenticated using (public.general_project_request_reader(id));

drop policy if exists general_project_request_messages_select on public.general_project_request_messages;
create policy general_project_request_messages_select on public.general_project_request_messages
  for select to authenticated using (public.general_project_request_reader(request_id));

revoke all on public.general_project_requests, public.general_project_request_messages
  from public, anon, authenticated;
grant select on public.general_project_requests, public.general_project_request_messages
  to authenticated;

create or replace function public.create_general_project_request(
  p_space uuid, p_title text, p_brief text, p_outcome text, p_target_date date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_space public.general_spaces%rowtype;
  v_id uuid;
begin
  if auth.uid() is null or not public.general_viewer_active()
     or not public.is_general_space_member(p_space) then
    raise exception 'Join this Space with an active account before making a request.'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_space from public.general_spaces where id = p_space;
  if v_space.kind <> 'work' then
    raise exception 'Project requests are only for work Spaces.' using errcode = 'check_violation';
  end if;
  if v_space.archived_at is not null then
    raise exception 'This Space is archived. Restore it before making a request.'
      using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200
     or char_length(btrim(coalesce(p_brief, ''))) not between 1 and 20000
     or char_length(btrim(coalesce(p_outcome, ''))) not between 1 and 2000 then
    raise exception 'Add a title, brief and outcome within their length limits.'
      using errcode = 'check_violation';
  end if;
  insert into public.general_project_requests
    (space_id, author_id, title, brief, desired_outcome, target_date)
  values (p_space, auth.uid(), btrim(p_title), btrim(p_brief), btrim(p_outcome), p_target_date)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.edit_general_project_request(
  p_request uuid, p_title text, p_brief text, p_outcome text, p_target_date date default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_request public.general_project_requests%rowtype;
begin
  select * into v_request from public.general_project_requests where id = p_request for update;
  if not found or v_request.author_id is distinct from auth.uid()
     or not public.general_project_request_reader(p_request) then
    raise exception 'Only the requester can edit this brief.' using errcode = 'insufficient_privilege';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This brief is no longer open for edits.' using errcode = 'check_violation';
  end if;
  if public.general_space_is_archived(v_request.space_id) then
    raise exception 'This Space is archived. Restore it before editing.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200
     or char_length(btrim(coalesce(p_brief, ''))) not between 1 and 20000
     or char_length(btrim(coalesce(p_outcome, ''))) not between 1 and 2000 then
    raise exception 'Add a title, brief and outcome within their length limits.'
      using errcode = 'check_violation';
  end if;
  update public.general_project_requests
     set title = btrim(p_title), brief = btrim(p_brief),
         desired_outcome = btrim(p_outcome), target_date = p_target_date
   where id = p_request;
end;
$$;

create or replace function public.post_general_project_request_message(p_request uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_request public.general_project_requests%rowtype;
  v_id uuid;
begin
  select * into v_request from public.general_project_requests where id = p_request for update;
  if not found or not public.general_project_request_reader(p_request) then
    raise exception 'You cannot join this request discussion.' using errcode = 'insufficient_privilege';
  end if;
  if v_request.status not in ('open', 'ready') then
    raise exception 'This request discussion is closed.' using errcode = 'check_violation';
  end if;
  if public.general_space_is_archived(v_request.space_id) then
    raise exception 'This Space is archived. Restore it before posting.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'Write a message of 1 to 5,000 characters.' using errcode = 'check_violation';
  end if;
  insert into public.general_project_request_messages (request_id, author_id, body)
  values (p_request, auth.uid(), btrim(p_body)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_general_project_request_status(p_request uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_request public.general_project_requests%rowtype;
begin
  select * into v_request from public.general_project_requests where id = p_request for update;
  if not found or not public.general_project_request_reader(p_request)
     or not public.general_viewer_active()
     or not exists (
       select 1 from public.general_space_members m
       join public.profiles p on p.id = m.user_id
        where m.space_id = v_request.space_id and m.user_id = auth.uid()
          and m.level in ('owner', 'manager') and p.can_manage_projects and p.status = 'active'
     ) then
    raise exception 'Only a Project manager in this Space can change the request status.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_space_is_archived(v_request.space_id) then
    raise exception 'This Space is archived. Restore it before changing a request.'
      using errcode = 'check_violation';
  end if;
  if v_request.status not in ('open', 'ready')
     or p_status not in ('ready', 'closed')
     or (p_status = 'ready' and v_request.status <> 'open') then
    raise exception 'This request cannot make that status change.' using errcode = 'check_violation';
  end if;
  update public.general_project_requests set status = p_status where id = p_request;
end;
$$;

revoke all on function public.general_project_request_reader(uuid) from public, anon;
revoke all on function public.create_general_project_request(uuid, text, text, text, date)
  from public, anon;
revoke all on function public.edit_general_project_request(uuid, text, text, text, date)
  from public, anon;
revoke all on function public.post_general_project_request_message(uuid, text) from public, anon;
revoke all on function public.set_general_project_request_status(uuid, text) from public, anon;
grant execute on function public.general_project_request_reader(uuid) to authenticated;
grant execute on function public.create_general_project_request(uuid, text, text, text, date)
  to authenticated;
grant execute on function public.edit_general_project_request(uuid, text, text, text, date)
  to authenticated;
grant execute on function public.post_general_project_request_message(uuid, text) to authenticated;
grant execute on function public.set_general_project_request_status(uuid, text) to authenticated;

commit;
