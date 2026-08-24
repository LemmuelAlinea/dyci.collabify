-- Collabify — how often one person may do a thing.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/rate-limit.sql

/**
 * Nothing in this product limited how fast anybody could act. A signed-in
 * student could ask the AI to draft tasks in a loop until the Anthropic bill
 * ran out, send ten thousand messages, or guess class join codes until one
 * worked. Every one of those is an authenticated action, so row-level security
 * had already said yes: policies answer "may you", never "how often".
 *
 * A fixed window per person per bucket. Deliberately simple:
 *
 *   - One row per (person, bucket), so the table stays the size of the people
 *     using it rather than growing with every action.
 *   - The window resets on first use after it lapses, so nothing has to sweep
 *     old rows on a schedule.
 *   - `security definer`, because the caller must not be able to edit their own
 *     allowance. Nobody has any grant on the table at all.
 *
 * **Only actions that complete are counted.** The count is written by the same
 * transaction as the work, so a statement that then fails takes the increment
 * back with it. That is fine for the load cases — nobody exhausts a server with
 * writes that get rejected — but it is exactly wrong for the one case where the
 * *failures* are the attack: guessing a class join code.
 *
 * So joining is limited inside `join_class` rather than by a trigger on
 * `class_members`. That function answers a wrong code by returning a result
 * instead of raising, so the transaction commits and the guess is counted. It
 * also keeps a professor adding somebody to their own roster from spending the
 * student's join allowance, which a trigger on the table could not tell apart.
 *
 * `auth.uid()` is null for the service role, and the limit is skipped there.
 * Migrations, the schedule and repair scripts are not the traffic this is for,
 * and rate-limiting the thing that fixes an outage would be a poor trade.
 */

begin;

create table if not exists public.rate_limits (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  bucket       text not null,
  window_start timestamptz not null default now(),
  count        integer not null default 0,
  primary key (user_id, bucket)
);

alter table public.rate_limits enable row level security;

-- No policy and no grant: this table is written only by the definer function
-- below, and read only by an admin through `rate_limit_status`.
revoke all on public.rate_limits from anon, authenticated;

comment on table public.rate_limits is
  'One row per person per bucket. Written only by public.rate_limit().';

-- ---------------------------------------------------------------- the check

/**
 * Count this action against `p_bucket`, and refuse it if the person is over
 * `p_max` within `p_per`.
 *
 * The upsert does the whole of it in one statement, which is what makes it safe
 * under concurrency: two requests arriving together both take the row lock in
 * turn and the second sees the first's count.
 */
create or replace function public.rate_limit(
  p_bucket  text,
  p_max     integer,
  p_per     interval,
  p_message text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  hits integer;
begin
  if uid is null then
    return;  -- service role: migrations, cron, repair scripts
  end if;

  insert into public.rate_limits as rl (user_id, bucket, window_start, count)
  values (uid, p_bucket, now(), 1)
  on conflict (user_id, bucket) do update
     set count = case
                   when rl.window_start < now() - p_per then 1
                   else rl.count + 1
                 end,
         window_start = case
                          when rl.window_start < now() - p_per then now()
                          else rl.window_start
                        end
  returning rl.count into hits;

  if hits > p_max then
    raise exception '%',
      coalesce(
        p_message,
        'That is faster than the system accepts. Wait a moment and try again.'
      )
      using errcode = 'check_violation';
  end if;
end;
$$;

/**
 * The same count, answered rather than raised.
 *
 * For callers that already speak in results — `join_class` returns a JSON
 * verdict for every outcome — turning one of those outcomes into an exception
 * would make the rate limit the only case the client has to catch instead of
 * read.
 */
create or replace function public.rate_limit_ok(
  p_bucket text,
  p_max    integer,
  p_per    interval
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.rate_limit(p_bucket, p_max, p_per, null);
  return true;
exception when check_violation then
  return false;
end;
$$;

revoke all on function public.rate_limit_ok(text, integer, interval) from public;
grant execute on function public.rate_limit_ok(text, integer, interval) to authenticated;

revoke all on function public.rate_limit(text, integer, interval, text) from public;
grant execute on function public.rate_limit(text, integer, interval, text) to authenticated;

/**
 * The same check as a trigger, so a table can be limited without writing a
 * function per table. Arguments are the bucket, the ceiling, the window and the
 * sentence the person reads.
 */
create or replace function public.enforce_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.rate_limit(
    tg_argv[0],
    tg_argv[1]::integer,
    tg_argv[2]::interval,
    tg_argv[3]
  );
  return new;
end;
$$;

/** What somebody is currently using, for the program office. */
create or replace view public.rate_limit_status
with (security_barrier = true) as
select r.user_id,
       btrim(p.first_name || ' ' || p.last_name) as person,
       r.bucket,
       r.count,
       r.window_start
  from public.rate_limits r
  join public.profiles p on p.id = r.user_id
 where public.is_admin();

grant select on public.rate_limit_status to authenticated;

commit;

-- ------------------------------------------------------------ the ceilings

/**
 * Set generously. A limit that a person doing their coursework can reach is a
 * bug, not a safeguard — the number to aim at is "no real user will ever see
 * this, and a script will see it immediately".
 *
 * Every message says what happened and what to do next, because a person who
 * hits one of these has usually done nothing wrong.
 */

begin;

-- --------------------------------------------------------------- messaging

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit before insert on public.messages
  for each row execute function public.enforce_rate_limit(
    'message_send', '40', '1 minute',
    'You are sending messages faster than the system accepts. Wait a minute and carry on.'
  );

drop trigger if exists task_comments_rate_limit on public.task_comments;
create trigger task_comments_rate_limit before insert on public.task_comments
  for each row execute function public.enforce_rate_limit(
    'task_comment', '30', '1 minute',
    'You are commenting faster than the system accepts. Wait a minute and carry on.'
  );

-- ----------------------------------------------------------- announcements

/**
 * These reach everybody at once and write a notification row per recipient, so
 * the ceiling is lower than the typing ones. Ten class notices in an hour is
 * already more than anybody sends in a term.
 */
drop trigger if exists announcements_rate_limit on public.announcements;
create trigger announcements_rate_limit before insert on public.announcements
  for each row execute function public.enforce_rate_limit(
    'class_announcement', '10', '1 hour',
    'That is ten announcements in an hour. Wait a while before sending another — every one of these reaches the whole class.'
  );

drop trigger if exists program_announcements_rate_limit on public.program_announcements;
create trigger program_announcements_rate_limit before insert on public.program_announcements
  for each row execute function public.enforce_rate_limit(
    'program_announcement', '6', '1 hour',
    'That is six notices in an hour. Wait a while — each one reaches every professor and student in the program.'
  );

-- -------------------------------------------------------------- enrolment

/**
 * Joining is limited inside `join_class` below, not by a trigger here. A
 * trigger on this table would count only the guesses that were *right*, and
 * would spend a student's allowance when their professor adds them to a roster.
 */
drop trigger if exists class_members_rate_limit on public.class_members;

-- ------------------------------------------------------------------- work

drop trigger if exists task_assignees_rate_limit on public.task_assignees;
create trigger task_assignees_rate_limit before insert on public.task_assignees
  for each row execute function public.enforce_rate_limit(
    'task_claim', '120', '1 minute',
    'You are claiming tasks faster than the system accepts. Wait a minute and carry on.'
  );

drop trigger if exists task_reassignments_rate_limit on public.task_reassignments;
create trigger task_reassignments_rate_limit before insert on public.task_reassignments
  for each row execute function public.enforce_rate_limit(
    'reassign_request', '15', '1 hour',
    'That is fifteen reassignment requests in an hour. Your professor has to answer each one — wait a while before asking again.'
  );

drop trigger if exists poll_votes_rate_limit on public.poll_votes;
create trigger poll_votes_rate_limit before insert on public.poll_votes
  for each row execute function public.enforce_rate_limit(
    'poll_vote', '60', '1 minute',
    'You are changing your vote faster than the system accepts. Wait a minute and try again.'
  );

drop trigger if exists projects_rate_limit on public.projects;
create trigger projects_rate_limit before insert on public.projects
  for each row execute function public.enforce_rate_limit(
    'project_create', '30', '1 hour',
    'That is thirty projects in an hour. Wait a while before setting another.'
  );

drop trigger if exists teaching_resources_rate_limit on public.teaching_resources;
create trigger teaching_resources_rate_limit before insert on public.teaching_resources
  for each row execute function public.enforce_rate_limit(
    'resource_create', '20', '1 hour',
    'That is twenty uploads in an hour. Wait a while before uploading another.'
  );

commit;

-- ----------------------------------------------------------------- storage

/**
 * Uploads are limited on `storage.objects`, which is where every bucket
 * arrives. One trigger, and the bucket decides the ceiling — an avatar is
 * replaced a handful of times ever, while a group swapping files on a board
 * legitimately uploads far more.
 *
 * `storage.objects` is owned by the storage role. If this project ever refuses
 * the trigger, the same check belongs in the bucket's insert policy instead;
 * the notice below says so rather than failing the whole file.
 */

-- Written outside a DO block: the function body needs its own dollar quoting,
-- and nesting `$$` inside `do $$ ... $$` ends the outer block at the first one.
create or replace function public.enforce_storage_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  perform public.rate_limit(
    'upload_' || new.bucket_id,
    case new.bucket_id
      when 'avatars'            then 15
      when 'teaching-resources' then 20
      when 'class-files'        then 40
      when 'project-files'      then 40
      when 'task-files'         then 60
      when 'chat-files'         then 60
      else 40
    end,
    interval '1 hour',
    'You have uploaded a lot of files in the last hour. Wait a while and try again.'
  );
  return new;
end;
$fn$;

do $outer$
begin
  execute 'drop trigger if exists storage_objects_rate_limit on storage.objects';
  execute 'create trigger storage_objects_rate_limit before insert on storage.objects
             for each row execute function public.enforce_storage_rate_limit()';
  raise notice 'storage upload limits installed';
exception when insufficient_privilege then
  raise notice 'storage.objects refused a trigger — add the check to the bucket insert policies instead';
end $outer$;

-- ------------------------------------------------------- what is not here

/**
 * Sign-in, sign-up and password reset are **not** limited by this file, and
 * cannot be. They never reach Postgres as an authenticated statement — GoTrue
 * handles them before any of this runs, and its ceilings live in the project's
 * auth settings rather than in the schema. `auth.config` is not a table this
 * role can write.
 *
 * They are the three that most need it, so they are written down rather than
 * left to be discovered. Set these in the Supabase dashboard, under
 * Authentication → Rate Limits:
 *
 *   Sign-ins / sign-ups per hour per IP    30
 *   Token refreshes per hour per IP        150
 *   Password-reset emails per hour         6
 *   OTP / magic-link emails per hour       6
 *   Verification emails per hour           6
 *
 * Two of those are worth understanding rather than copying. Sign-in is per IP,
 * so a whole computer lab behind one campus address shares the allowance —
 * which is why 30 rather than the 5 a bank would use. And the email limits do
 * nothing at all today, because outbound mail is switched off; they matter the
 * moment it is turned on, which is the moment somebody would forget.
 *
 * Nothing in the product depends on those being set. They are defence in
 * depth over what Supabase already applies by default.
 */

-- ------------------------------------------------------ guessing a code

/**
 * `join_class`, with a ceiling on how many codes one person may try.
 *
 * Redefined here rather than in classes.sql because the counter this needs is
 * defined in this file, and a file cannot call a function it runs before. The
 * body is otherwise unchanged — see classes.sql for what each verdict means.
 *
 * The check comes first, before the code is even looked at, so a wrong code
 * costs the same as a right one. Ten an hour: a student mistyping a code from a
 * whiteboard has three or four goes, and anybody working through the keyspace
 * runs out immediately.
 */
create or replace function public.join_class(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  target   public.classes%rowtype;
  caller   public.profiles%rowtype;
  existing public.class_members%rowtype;
begin
  select * into caller from public.profiles where id = auth.uid();
  if not found then
    return jsonb_build_object('result', 'not_signed_in');
  end if;
  if caller.role <> 'student' then
    return jsonb_build_object('result', 'not_student');
  end if;

  -- Counted before the code is read, so a wrong guess costs an attempt.
  if not public.rate_limit_ok('class_join', 10, interval '1 hour') then
    return jsonb_build_object('result', 'too_many');
  end if;

  select * into target from public.classes where upper(code) = upper(trim(p_code));
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if target.archived_at is not null then
    return jsonb_build_object('result', 'archived');
  end if;

  select * into existing from public.class_members
   where class_id = target.id and student_id = caller.id;

  if found and existing.status = 'removed' then
    return jsonb_build_object('result', 'blocked');
  end if;
  if found then
    return jsonb_build_object('result', 'already_member', 'class_id', target.id);
  end if;
  if not target.join_open then
    return jsonb_build_object('result', 'closed');
  end if;

  insert into public.class_members (class_id, student_id) values (target.id, caller.id);
  return jsonb_build_object('result', 'joined', 'class_id', target.id);
end;
$$;

revoke all on function public.join_class(text) from public;
grant execute on function public.join_class(text) to authenticated;
