-- Keep finished sprints available after they leave the main Sprints list.
-- Run after class-planning.sql and work-planning.sql. Idempotent.

begin;

alter table public.general_sprints add column if not exists archived boolean not null default false;
alter table public.board_sprints add column if not exists archived boolean not null default false;

do $$ begin
  alter table public.general_sprints add constraint general_sprints_archive_finished
    check (not archived or state = 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.board_sprints add constraint board_sprints_archive_finished
    check (not archived or state = 'completed');
exception when duplicate_object then null; end $$;

commit;
