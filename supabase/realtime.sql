-- Collabify — realtime delivery fixes.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/realtime.sql

begin;

-- With the default replica identity, an UPDATE or DELETE event carries only the
-- primary key of the old row. Realtime cannot evaluate RLS or a column filter
-- against that, so those events get dropped for RLS-protected tables — which is
-- why unvoting a poll (a DELETE on poll_votes) never reached other viewers.
alter table public.messages            replica identity full;
alter table public.message_attachments replica identity full;
alter table public.poll_votes          replica identity full;
alter table public.poll_options        replica identity full;

-- polls itself changes on close/reopen, which viewers need to see.
do $$ begin
  alter publication supabase_realtime add table public.polls;
exception when duplicate_object then null; end $$;

alter table public.polls replica identity full;

commit;
