-- Collabify video meetings. Apply after project-open-tasks.sql and before
-- anon-lockdown.sql. Later tasks add call state, chat and recordings here.
-- Idempotent: safe to run repeatedly.

alter table public.organization_settings
  add column if not exists meeting_calls_enabled boolean not null default false;
