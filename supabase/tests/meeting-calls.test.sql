-- Collabify call access checks. Every fixture rolls back.
begin;

create or replace function pg_temp.must_be(p_label text, p_ok boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 64);
    return;
  end;
  raise exception 'FAIL  % — it went through', p_label;
end;
$$;

do $$
begin
  perform pg_temp.must_be('new call feature is disabled before release',
    (select not meeting_calls_enabled from public.organization_settings where id));
  perform set_config('role', 'authenticated', true);
  perform pg_temp.must_refuse('members cannot enable calls',
    'update public.organization_settings set meeting_calls_enabled = true where id');
end $$;

rollback;
