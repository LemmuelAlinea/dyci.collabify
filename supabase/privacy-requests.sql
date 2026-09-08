-- Collabify — the route a data subject uses to exercise their rights.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/privacy-requests.sql

/**
 * The privacy policy tells students they can ask for access, correction,
 * erasure, portability, objection and withdrawal. RA 10173 lets those rights be
 * exercised **by request** — nothing in the Act requires a self-service button
 * — but a documented process that reaches a real person is the whole of what
 * makes that lawful. Without this table the policy would be a written promise
 * with nothing behind it.
 *
 * Shaped after `task_reassignments`, which is the same problem already solved
 * well in this codebase: somebody asks, somebody with standing answers, both
 * are told, and the record survives the answer.
 *
 * Not a `mailto:` link — no record, depends on a configured mail client, and
 * puts a scrapeable address on a public page. Not an edge function — a third
 * deploy target, and it would route the *contents* of a request through Brevo.
 * A row in a table the handler already has a screen for is less machinery and
 * more evidence. The form keeps a mailto line as a stated fallback for anyone
 * who cannot sign in, which is precisely the person a signed-in-only route
 * would fail.
 */

-- A new enum value cannot be used in the transaction that added it.
begin;

do $$
begin
  alter type public.notification_type add value if not exists 'privacy_request';
end $$;

commit;

begin;

-- ------------------------------------------------------------- who answers

/**
 * The one person who receives requests, mirroring `PRIVACY_CONTACT` in
 * `src/lib/legal/contact.ts`. The document says who receives them; this table
 * decides who actually sees them, and the two have to name the same person.
 *
 * One row, enforced. A second handler would mean a request silently reaching
 * whichever of them looked first, and neither knowing they were both meant to.
 */
create table if not exists public.privacy_handler (
  id           boolean primary key default true check (id),
  professor_id uuid not null references public.profiles (id) on delete restrict,
  set_at       timestamptz not null default now()
);

alter table public.privacy_handler enable row level security;

drop policy if exists privacy_handler_read on public.privacy_handler;
create policy privacy_handler_read on public.privacy_handler
  for select to authenticated using (true);

-- Set by an admin through the service role, deliberately. Naming the person
-- who answers statutory requests is not a screen anybody should have.
comment on table public.privacy_handler is
  'One row. The professor who receives privacy requests on the college''s behalf.';

/**
 * Whether the caller answers privacy requests.
 *
 * **Falls back to admin while the table is empty**, so a request made before
 * anybody has been named is never orphaned — it lands in the admin queue
 * instead of nowhere. An unanswerable request is worse than an
 * inconveniently-routed one, because the fifteen-working-day clock runs either
 * way.
 */
create or replace function public.is_privacy_handler()
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.privacy_handler)
      then exists (
        select 1 from public.privacy_handler
         where professor_id = auth.uid()
      ) or public.is_admin()
    else public.is_admin()
  end;
$$;

-- ------------------------------------------------------------- the requests

do $$
begin
  create type public.privacy_request_kind as enum (
    'access', 'correction', 'erasure', 'objection', 'portability', 'withdraw_consent'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.privacy_request_status as enum (
    'open', 'acknowledged', 'completed', 'refused'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.privacy_requests (
  id            uuid primary key default gen_random_uuid(),

  /**
   * `on delete set null`, not cascade.
   *
   * Erasure is the one request whose completion may remove the person who made
   * it. Cascading would delete the proof that the erasure was asked for and
   * carried out, which is the record most worth keeping — so the row survives
   * its requester, carrying the snapshot below.
   */
  requester_id  uuid references public.profiles (id) on delete set null,
  requester_name  text not null,
  requester_email text not null,

  kind          public.privacy_request_kind not null,
  detail        text not null default '',
  status        public.privacy_request_status not null default 'open',

  /**
   * The clock, as dates rather than a computed column, so the queue can show
   * days remaining without every reader re-deriving the policy's promise. The
   * privacy policy commits to acknowledging within five working days and
   * completing within fifteen; these are calendar days, which is the stricter
   * reading and the one worth being held to.
   */
  acknowledge_by date not null default (current_date + 5),
  complete_by    date not null default (current_date + 15),

  answered_by   uuid references public.profiles (id) on delete set null,
  answer        text,
  answered_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists privacy_requests_queue_idx
  on public.privacy_requests (status, complete_by);
create index if not exists privacy_requests_mine_idx
  on public.privacy_requests (requester_id, created_at desc);

alter table public.privacy_requests enable row level security;

drop policy if exists privacy_requests_select on public.privacy_requests;
create policy privacy_requests_select on public.privacy_requests
  for select to authenticated
  using (requester_id = auth.uid() or public.is_privacy_handler());

/**
 * No insert policy. Requests arrive only through `make_privacy_request` below,
 * which is where the throttle and the snapshot live — an open insert policy
 * would let a client write a row with somebody else's name on it and no rate
 * limit.
 *
 * No update or delete policy for anybody, including the handler. Status moves
 * only through `answer_privacy_request`, so an answer always carries who gave
 * it and when. Same shape as `decide_reassignment`.
 */
revoke insert, update, delete on public.privacy_requests from anon, authenticated;

comment on table public.privacy_requests is
  'Data-subject requests under RA 10173. Written only by make_privacy_request and answer_privacy_request.';

-- -------------------------------------------------------------- making one

create or replace function public.make_privacy_request(
  p_kind   public.privacy_request_kind,
  p_detail text default ''
) returns public.privacy_requests
language plpgsql security definer set search_path = public as $$
declare
  me   public.profiles;
  req  public.privacy_requests;
  handler uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'Sign in to make a privacy request.' using errcode = 'P0001';
  end if;

  /**
   * Reuses `public.rate_limit()` rather than inventing a second throttle.
   *
   * Three a day is generous for a statutory right and still stops the table
   * being filled by a held button. It counts requests that succeed, which is
   * the right way round here: a refused insert is not a request.
   */
  perform public.rate_limit(
    'privacy_request', 3, interval '1 day',
    'You have made three privacy requests today. The ones already open are being handled.'
  );

  insert into public.privacy_requests
    (requester_id, requester_name, requester_email, kind, detail)
  values (
    me.id,
    trim(both from me.first_name || ' ' || me.last_name),
    me.email,
    p_kind,
    coalesce(trim(both from p_detail), '')
  )
  returning * into req;

  -- The handler hears about it, ungated by notification_prefs under the rule
  -- in notifications.sql: anything a person must act on arrives regardless of
  -- their settings. A statutory clock is the clearest case of that there is.
  select professor_id into handler from public.privacy_handler limit 1;

  if handler is not null then
    insert into public.notifications (user_id, type, title, preview)
    values (
      handler, 'privacy_request',
      'Privacy request: ' || p_kind::text,
      req.requester_name || ' asked for ' || p_kind::text ||
      '. Answer by ' || to_char(req.complete_by, 'DD Mon YYYY') || '.'
    );
  else
    -- Nobody named yet, so every admin hears it. See is_privacy_handler().
    insert into public.notifications (user_id, type, title, preview)
    select p.id, 'privacy_request',
           'Privacy request: ' || p_kind::text,
           req.requester_name || ' asked for ' || p_kind::text ||
           '. No privacy handler is set, so this reached the admins.'
      from public.profiles p
     where p.role = 'admin' and p.status = 'active';
  end if;

  return req;
end;
$$;

revoke all on function public.make_privacy_request(public.privacy_request_kind, text) from public;
grant execute on function public.make_privacy_request(public.privacy_request_kind, text) to authenticated;

-- ------------------------------------------------------------- answering it

/**
 * Move a request forward and tell the person who made it.
 *
 * Mirrors `decide_reassignment`: the only way the status changes, so nothing
 * lands without an author and a timestamp. The work itself — pulling the rows,
 * blanking the messages, running `scripts/subject-export.mjs` — happens by hand
 * outside the database, and `docs/10-privacy-requests.md` is the checklist for
 * each kind. This function records what was done, it does not do it.
 */
create or replace function public.answer_privacy_request(
  p_request uuid,
  p_status  public.privacy_request_status,
  p_answer  text default null
) returns public.privacy_requests
language plpgsql security definer set search_path = public as $$
declare
  req public.privacy_requests;
begin
  if not public.is_privacy_handler() then
    raise exception 'Only the privacy handler answers these.' using errcode = '42501';
  end if;

  if p_status = 'open' then
    raise exception 'A request cannot be moved back to open.' using errcode = 'P0001';
  end if;

  -- Refusing is a decision the person is entitled to challenge, so it has to
  -- carry a ground. §16(e) gives them the right to know why.
  if p_status = 'refused' and coalesce(trim(both from p_answer), '') = '' then
    raise exception 'Say why it was refused. The person may take this to the National Privacy Commission.'
      using errcode = 'P0001';
  end if;

  update public.privacy_requests
     set status      = p_status,
         answer      = coalesce(nullif(trim(both from p_answer), ''), answer),
         answered_by = auth.uid(),
         answered_at = now()
   where id = p_request
  returning * into req;

  if req.id is null then
    raise exception 'That request does not exist.' using errcode = 'P0001';
  end if;

  -- The requester hears every move, including the acknowledgement, because the
  -- five-day promise is only worth making if they can see it kept. Ungated for
  -- the same reason the handler's notification is.
  if req.requester_id is not null then
    insert into public.notifications (user_id, type, title, preview)
    values (
      req.requester_id, 'privacy_request',
      'Your privacy request was ' || p_status::text,
      coalesce(
        nullif(req.answer, ''),
        case p_status
          when 'acknowledged' then 'Received. You will have an answer by ' ||
                                   to_char(req.complete_by, 'DD Mon YYYY') || '.'
          when 'completed'    then 'This has been carried out.'
          else 'See the reason on the request.'
        end
      )
    );
  end if;

  return req;
end;
$$;

revoke all on function public.answer_privacy_request(uuid, public.privacy_request_status, text) from public;
grant execute on function public.answer_privacy_request(uuid, public.privacy_request_status, text) to authenticated;

commit;
