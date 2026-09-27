-- One-workplace cleanup: old workplace landing state is gone. Rolls back.

begin;

create or replace function pg_temp.must_be(label text, ok boolean)
returns void
language plpgsql
as $$
begin
  if not ok then
    raise exception 'check failed: %', label;
  end if;
end
$$;

do $$
begin
  perform pg_temp.must_be(
    'profiles.home_workplace was dropped',
    not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'home_workplace'
    )
  );

  perform pg_temp.must_be(
    'public.workplace enum was dropped',
    not exists (
      select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname = 'workplace'
    )
  );

  perform pg_temp.must_be(
    'general_space_overview keeps kind',
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'general_space_overview'
        and column_name = 'kind'
    )
  );

  perform pg_temp.must_be(
    'general_space_overview keeps class_id',
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'general_space_overview'
        and column_name = 'class_id'
    )
  );
end
$$;

rollback;
