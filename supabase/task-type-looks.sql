-- supabase/task-type-looks.sql
-- Task type sets: every work and class project keeps an ordered list of task types, each with a
-- name, description, color and icon. A work project has two fixed slots, the default type (a task
-- with no task_type) and the bug type (kind = 'bug', QA's); a class project has the default only
-- (task_type = 'Task'). Custom types are matched by name, so a task row never changes shape.
--
-- Runs after stage-plan.sql and before anon-lockdown.sql. It redefines nothing another file owns:
-- the guards in project-task-types.sql and class-task-settings.sql keep running beside these, and
-- task_types (the custom names) is kept in step by the save functions. Only those functions write
-- the set, under the transaction flag collabify.task_type_save. Re-run anon-lockdown.sql after it.

-- ---------------------------------------------------------------- the icons a type may wear

-- Held to TASK_TYPE_ICONS in src/lib/taskTypes/icons.ts, in the same order, by a test.
create or replace function public.task_type_icon_keys()
returns text[] language sql immutable set search_path = public as $$
  select array['square-check', 'bug', 'rocket', 'layers', 'user-plus', 'list-todo', 'clipboard-check',
    'zap', 'package', 'list-checks', 'file-text', 'circle-alert', 'circle-check', 'search', 'target',
    'book-open', 'database', 'chart', 'flask', 'file-pen', 'shield-check', 'square-pen', 'scale',
    'pie-chart', 'cog', 'calculator', 'users', 'globe', 'shield-alert', 'hard-hat', 'shovel',
    'shopping-cart', 'wrench', 'scan-search', 'file-check', 'triangle-alert', 'handshake', 'building',
    'key', 'map-pin', 'megaphone', 'wallet', 'lightbulb', 'pen-tool', 'palette', 'radio', 'send',
    'calendar', 'truck', 'monitor-play', 'image', 'scissors', 'scan-eye', 'refresh-cw', 'user-search',
    'filter', 'messages-square', 'graduation-cap', 'user-minus', 'briefcase', 'workflow', 'inbox',
    'drafting-compass', 'factory', 'receipt', 'arrow-left-right', 'file-chart', 'tag']::text[]
$$;

-- ---------------------------------------------------------------- the default sets

create or replace function public.default_task_type_set(p_family text)
returns jsonb language sql immutable set search_path = public as $$
  select case when p_family = 'class' then
    '[{"slot":"default","name":"Task","description":"Standard actionable work.","color":"#2563eb","icon":"square-check"}]'::jsonb
  else
    '[{"slot":"default","name":"Task","description":"Standard actionable work.","color":"#2563eb","icon":"square-check"},
      {"slot":"bug","name":"Bug","description":"Errors, defects, and issues requiring fixes.","color":"#dc2626","icon":"bug"}]'::jsonb
  end
$$;

alter table public.general_projects
  add column if not exists task_type_set jsonb not null default public.default_task_type_set('work'),
  add column if not exists task_type_preset text;
alter table public.general_projects
  add column if not exists task_type_set_shown text generated always as (md5(task_type_set::text)) stored;

alter table public.projects
  add column if not exists task_type_set jsonb not null default public.default_task_type_set('class'),
  add column if not exists task_type_preset text;
alter table public.projects
  add column if not exists task_type_set_shown text generated always as (md5(task_type_set::text)) stored;

-- ---------------------------------------------------------------- what a set must be

-- Null when the set is valid, else the message a person reads. p_family is 'work' or 'class'.
-- src/lib/taskTypes/typeSet.ts (typeSetProblem) mirrors it, message for message.
create or replace function public.task_type_set_problem(p_set jsonb, p_family text)
returns text language plpgsql stable set search_path = public as $$
declare
  shape constant text := 'Each task type needs a slot, name, description, color and icon.';
  names_msg text := case when p_family = 'class'
    then 'Use distinct names of 1 to 40 characters. Task stays reserved for the built-in type.'
    else 'Use distinct names of 1 to 40 characters. Task and Bug stay reserved for the built-in types.' end;
  e jsonb;
  defaults int := 0;
  bugs int := 0;
  customs int := 0;
  seen text[] := '{}';
  nm text;
  icons text[] := public.task_type_icon_keys();
begin
  if p_set is null or jsonb_typeof(p_set) <> 'array' then return shape; end if;
  for e in select value from jsonb_array_elements(p_set) loop
    if jsonb_typeof(e) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(e) k)
          is distinct from array['color', 'description', 'icon', 'name', 'slot']
       or jsonb_typeof(e -> 'name') <> 'string' or jsonb_typeof(e -> 'description') <> 'string'
       or jsonb_typeof(e -> 'color') <> 'string' or jsonb_typeof(e -> 'icon') <> 'string'
       or not (jsonb_typeof(e -> 'slot') = 'null' or (e ->> 'slot') in ('default', 'bug')) then
      return shape;
    end if;
    if e ->> 'slot' = 'default' then defaults := defaults + 1;
    elsif e ->> 'slot' = 'bug' then bugs := bugs + 1;
    else customs := customs + 1;
    end if;
  end loop;
  if defaults <> 1 then return 'Keep one default type.'; end if;
  if p_family = 'class' and bugs > 0 then return 'Class projects have no bug type.'; end if;
  if p_family <> 'class' and bugs <> 1 then return 'Keep one bug type.'; end if;
  if customs > 20 then return 'Keep at most 20 custom task types.'; end if;
  for e in select value from jsonb_array_elements(p_set) loop
    nm := e ->> 'name';
    if nm <> btrim(nm) or char_length(nm) not between 1 and 40 or lower(nm) = any(seen)
       or (e ->> 'slot' is null and (lower(nm) = 'task' or (p_family <> 'class' and lower(nm) = 'bug'))) then
      return names_msg;
    end if;
    seen := array_append(seen, lower(nm));
  end loop;
  for e in select value from jsonb_array_elements(p_set) loop
    if char_length(e ->> 'description') > 120 or (e ->> 'description') <> btrim(e ->> 'description') then
      return 'Keep each description to 120 characters.';
    end if;
  end loop;
  for e in select value from jsonb_array_elements(p_set) loop
    if (e ->> 'color') !~ '^#[0-9a-f]{6}$' then return 'Choose a color as #rrggbb.'; end if;
  end loop;
  for e in select value from jsonb_array_elements(p_set) loop
    if not ((e ->> 'icon') = any(icons)) then return 'Choose an icon from the list.'; end if;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------- the guard on both tables

-- Signed-in callers change a set only through the save functions (the flag). Every write is
-- checked, the service role's included.
create or replace function public.guard_task_type_set()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  fam text := case when tg_table_name = 'projects' then 'class' else 'work' end;
  problem text;
begin
  if auth.uid() is not null and coalesce(current_setting('collabify.task_type_save', true), '') <> 'on'
     and ((tg_op = 'UPDATE' and (new.task_type_set is distinct from old.task_type_set
            or new.task_types is distinct from old.task_types
            or new.task_type_preset is distinct from old.task_type_preset))
       or (tg_op = 'INSERT' and (new.task_type_set is distinct from public.default_task_type_set(fam)
            or new.task_type_preset is not null or cardinality(new.task_types) > 0))) then
    raise exception 'Change task types in Settings.' using errcode = 'insufficient_privilege';
  end if;
  problem := public.task_type_set_problem(new.task_type_set, fam);
  if problem is not null then
    raise exception '%', problem using errcode = 'check_violation';
  end if;
  if new.task_type_preset is not null and new.task_type_preset !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'Choose a preset from the list.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists general_projects_task_type_set_guard on public.general_projects;
create trigger general_projects_task_type_set_guard
  before insert or update of task_type_set, task_types, task_type_preset on public.general_projects
  for each row execute function public.guard_task_type_set();

drop trigger if exists projects_task_type_set_guard on public.projects;
create trigger projects_task_type_set_guard
  before insert or update of task_type_set, task_types, task_type_preset on public.projects
  for each row execute function public.guard_task_type_set();

-- ---------------------------------------------------------------- backfill

-- Names in task_types that the set lacks join it as custom types, once: no description, the tag
-- icon, and a color from the swatch order after blue and red. A second run changes nothing.
create or replace function public.backfill_task_type_sets()
returns void language plpgsql security definer set search_path = public as $$
declare
  palette constant text[] := array['#0891b2', '#9333ea', '#16a34a', '#d97706', '#0d9488', '#db2777',
    '#4f46e5', '#ea580c', '#64748b', '#a16207', '#7c3aed'];
  prior text := coalesce(current_setting('collabify.task_type_save', true), 'off');
  r record;
  s jsonb;
  nm text;
  n int;
begin
  perform set_config('collabify.task_type_save', 'on', true);
  for r in select g.id, g.task_type_set, g.task_types from public.general_projects g
            where exists (select 1 from unnest(g.task_types) x
                           where not exists (select 1 from jsonb_array_elements(g.task_type_set) e
                                              where e ->> 'slot' is null and e ->> 'name' = x)) loop
    s := r.task_type_set;
    foreach nm in array r.task_types loop
      if not exists (select 1 from jsonb_array_elements(s) e where e ->> 'slot' is null and e ->> 'name' = nm) then
        n := (select count(*) from jsonb_array_elements(s) e where e ->> 'slot' is null);
        s := s || jsonb_build_array(jsonb_build_object('slot', null, 'name', nm, 'description', '',
          'color', palette[(n % 11) + 1], 'icon', 'tag'));
      end if;
    end loop;
    update public.general_projects set task_type_set = s where id = r.id;
  end loop;
  for r in select p.id, p.task_type_set, p.task_types from public.projects p
            where exists (select 1 from unnest(p.task_types) x
                           where not exists (select 1 from jsonb_array_elements(p.task_type_set) e
                                              where e ->> 'slot' is null and e ->> 'name' = x)) loop
    s := r.task_type_set;
    foreach nm in array r.task_types loop
      if not exists (select 1 from jsonb_array_elements(s) e where e ->> 'slot' is null and e ->> 'name' = nm) then
        n := (select count(*) from jsonb_array_elements(s) e where e ->> 'slot' is null);
        s := s || jsonb_build_array(jsonb_build_object('slot', null, 'name', nm, 'description', '',
          'color', palette[(n % 11) + 1], 'icon', 'tag'));
      end if;
    end loop;
    update public.projects set task_type_set = s where id = r.id;
  end loop;
  perform set_config('collabify.task_type_save', prior, true);
end $$;

select public.backfill_task_type_sets();

revoke all on function public.task_type_set_problem(jsonb, text), public.guard_task_type_set(),
  public.backfill_task_type_sets() from public, anon, authenticated;
-- Column defaults run as the inserting person, so these two stay callable.
revoke all on function public.default_task_type_set(text), public.task_type_icon_keys() from public, anon;
grant execute on function public.default_task_type_set(text), public.task_type_icon_keys() to authenticated;
