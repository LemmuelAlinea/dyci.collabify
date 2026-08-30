-- Collabify — one project across several sections of the same course.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/project-series.sql

/**
 * A professor teaching four sections of one course had to build the same
 * project four times, then edit it four times whenever anything changed.
 *
 * **The row stays per class.** `projects.class_id` is untouched and still
 * single. A series is a nullable `series_id` shared by siblings, so every
 * board, task, submission, result, calendar event and analytics view keeps
 * working exactly as it did — each section still has precisely the project row
 * it has today. `series_id is null` is an ordinary one-class project, which is
 * every project that already exists.
 *
 * That is also what makes the deadline case work. 3A's `due_at` is its own
 * column on its own row, so extending 3A alone touches nothing in 3B or 3C.
 * Every function here therefore takes the sections to act on as an explicit
 * list rather than assuming the whole series.
 *
 * **What never propagates:** `class_id`, `created_by`, `series_id`, and
 * `audience` / `group_set_id`. A group set belongs to one class
 * (`group_sets.class_id`), so one value could not span sections even in
 * principle — each section names its own arrangement when the series is
 * created, and changes it on its own project afterwards.
 *
 * Nothing here is `security definer`. The insert and update policies on
 * `projects` already say a professor may only write their own classes, so RLS
 * is the enforcement and these functions run as the caller. The explicit
 * `is_class_professor` checks exist for the error message, not the rule.
 */

begin;

-- ---------------------------------------------------------------- column

alter table public.projects
  add column if not exists series_id uuid;

comment on column public.projects.series_id is
  'Null for a one-class project. Shared by the sibling projects created for '
  'several sections of the same course in one action.';

create index if not exists projects_series_idx
  on public.projects (series_id) where series_id is not null;

-- ---------------------------------------------------------------- views

/**
 * `project_overview` is `select p.*`, and Postgres freezes that star when the
 * view is created — adding `series_id` above does not reach a view that
 * already exists, so every page would read the column as undefined. This is
 * the third file to drop and rebuild it, after `projects.sql` and
 * `deadline-lock.sql`.
 *
 * The definition below is deliberately **byte-identical** to theirs. All three
 * are `select p.*`, so whichever runs last now produces the same shape, and
 * re-running an older file cannot silently take `series_id` away again. Keep
 * it that way: anything this feature needs beyond the star goes in
 * `project_series_members` below, not in here.
 */
drop view if exists public.project_overview;

create view public.project_overview
with (security_invoker = true) as
select p.*,
       c.name    as class_name,
       c.initial as class_initial,
       s.name    as group_set_name,
       (select count(*) from public.project_criteria x where x.project_id = p.id)::int
         as criteria_count,
       (select coalesce(sum(x.max_points), 0) from public.project_criteria x
         where x.project_id = p.id)::int as criteria_points,
       (select count(*) from public.project_attachments a where a.project_id = p.id)::int
         as attachment_count,
       (p.release_at is not null and p.release_at > now()) as scheduled,
       (select w.title from public.syllabus_weeks w
         where w.resource_id = c.syllabus_id and w.week_no = p.start_week) as start_week_title,
       (select string_agg(w.assessments, ' · ' order by w.week_no)
          from public.syllabus_weeks w
         where w.resource_id = c.syllabus_id
           and w.week_no between p.start_week and p.end_week
           and w.assessments <> '') as week_assessments
  from public.projects p
  join public.classes c on c.id = p.class_id
  left join public.group_sets s on s.id = p.group_set_id;

grant select on public.project_overview to authenticated;

/**
 * The sections a series runs in, with the state each one is actually in — the
 * deadline, the lock and the release differ per section on purpose, and the
 * scope picker has to show what it is about to change.
 *
 * `security_invoker`, so it carries no rule of its own: a professor sees their
 * own sections because `projects_select` says so, and a student sees only the
 * sibling they are enrolled in. That is why it cannot drift out of step with
 * the policies.
 */
drop view if exists public.project_series_members;

create view public.project_series_members
with (security_invoker = true) as
select p.series_id,
       p.id         as project_id,
       p.class_id,
       c.initial    as class_initial,
       c.name       as class_name,
       c.section,
       p.title,
       p.audience,
       p.group_set_id,
       s.name       as group_set_name,
       p.start_week,
       p.end_week,
       p.due_at,
       p.release_at,
       p.locked_at,
       p.archived_at,
       p.created_at
  from public.projects p
  join public.classes c on c.id = p.class_id
  left join public.group_sets s on s.id = p.group_set_id
 where p.series_id is not null;

grant select on public.project_series_members to authenticated;

-- ---------------------------------------------------------------- helpers

/**
 * Validates the sections an action names, and answers with the series they
 * belong to.
 *
 * Three things it refuses, each of which would otherwise be a way to reach a
 * project the caller has no business editing through a list they control:
 * a project that does not exist or is not theirs, a mix of two different
 * series, and a project outside the series entirely.
 */
create or replace function public.series_targets_check(p_targets uuid[])
returns uuid language plpgsql stable set search_path = public as $$
declare
  r        record;
  found    uuid;
  n        int := 0;
begin
  if p_targets is null or array_length(p_targets, 1) is null then
    raise exception 'Choose at least one section to apply this to';
  end if;

  for r in
    select p.id, p.series_id, p.class_id, c.initial, c.section
      from public.projects p
      join public.classes c on c.id = p.class_id
     where p.id = any(p_targets)
  loop
    if not public.is_class_professor(r.class_id) then
      raise exception 'You do not teach %  ·  %', r.initial, r.section;
    end if;
    if n = 0 then
      found := r.series_id;
    elsif found is distinct from r.series_id then
      raise exception 'Those projects are not sections of the same one';
    end if;
    n := n + 1;
  end loop;

  if n <> array_length(p_targets, 1) then
    raise exception 'One of those projects no longer exists, or is not yours';
  end if;
  -- A single project with no series is legitimate: the same functions serve
  -- the ordinary one-class case, so the UI has one path rather than two.
  if found is null and n > 1 then
    raise exception 'Those projects are not sections of the same one';
  end if;

  return found;
end;
$$;

/** Writes a rubric wholesale, the same way the client always has. */
create or replace function public.series_write_criteria(p_project uuid, p_criteria jsonb)
returns void language plpgsql set search_path = public as $$
begin
  if p_criteria is null then return; end if;

  delete from public.project_criteria where project_id = p_project;

  insert into public.project_criteria (project_id, position, label, description, max_points)
  select p_project,
         (row_number() over ())::int,
         btrim(c->>'label'),
         coalesce(c->>'description', ''),
         coalesce((c->>'max_points')::int, 10)
    from jsonb_array_elements(p_criteria) c
   where btrim(coalesce(c->>'label', '')) <> '';
end;
$$;

-- ---------------------------------------------------------------- create

/**
 * Creates one project per section in a single transaction, all sharing a new
 * series id, and returns the new ids in the order the sections were given.
 *
 * One transaction is the point: a fan-out that half-succeeds leaves the
 * professor with two sections holding a project and two not, and no record of
 * which. If any section refuses — a syllabus without those weeks, a group set
 * from the wrong class — none of them are written.
 *
 * `p_targets` is `[{"class_id": …, "group_set_id": … | null}, …]`, because the
 * group set cannot be one shared value: it belongs to a class.
 */
create or replace function public.create_project_series(
  p_targets      jsonb,
  p_title        text,
  p_type         public.project_type,
  p_type_label   text,
  p_guidelines   text,
  p_start_week   int,
  p_end_week     int,
  p_audience     public.project_audience,
  p_total_points int,
  p_due_at       timestamptz,
  p_release_at   timestamptz,
  p_criteria     jsonb default null
) returns uuid[] language plpgsql set search_path = public as $$
declare
  t         jsonb;
  cls       uuid;
  gset      uuid;
  series    uuid;
  new_id    uuid;
  ids       uuid[] := '{}';
  label     text;
  n         int := jsonb_array_length(coalesce(p_targets, '[]'::jsonb));
begin
  if n = 0 then
    raise exception 'Choose at least one section';
  end if;
  -- Only a set of siblings is a series. One section alone is an ordinary
  -- project, and marking it as a series would put a scope picker in front of
  -- somebody who has nothing to scope.
  series := case when n > 1 then gen_random_uuid() end;

  for t in select * from jsonb_array_elements(p_targets)
  loop
    cls  := (t->>'class_id')::uuid;
    gset := nullif(t->>'group_set_id', '')::uuid;

    -- A class that is not theirs is not merely refused, it is invisible:
    -- `classes_select` means the lookup returns nothing at all. Both cases
    -- are the same answer, so they get the same sentence.
    select c.initial || '  ·  ' || c.section into label
      from public.classes c where c.id = cls;
    if label is null or not public.is_class_professor(cls) then
      raise exception 'You do not teach one of the sections you chose';
    end if;

    begin
      insert into public.projects (
        class_id, created_by, series_id, title, type, type_label, guidelines,
        start_week, end_week, audience, group_set_id, total_points,
        due_at, release_at
      ) values (
        cls, auth.uid(), series, btrim(p_title), p_type,
        case when p_type = 'other' then btrim(p_type_label) end,
        btrim(p_guidelines), p_start_week, p_end_week, p_audience,
        case when p_audience = 'group' then gset end,
        p_total_points, p_due_at, p_release_at
      )
      returning id into new_id;
    exception when others then
      -- Which section refused is the whole of the useful information, and the
      -- trigger that raised knows nothing about the fan-out.
      raise exception '% — %', label, sqlerrm;
    end;

    perform public.series_write_criteria(new_id, p_criteria);
    ids := ids || new_id;
  end loop;

  return ids;
end;
$$;

-- ---------------------------------------------------------------- update

/**
 * Applies the shared half of a project to the sections named, and only those.
 *
 * `audience` and `group_set_id` are absent by design — see the file header.
 * `p_criteria` null leaves each section's rubric alone; an array replaces it
 * everywhere in scope.
 */
create or replace function public.update_project_series(
  p_targets      uuid[],
  p_title        text,
  p_type         public.project_type,
  p_type_label   text,
  p_guidelines   text,
  p_start_week   int,
  p_end_week     int,
  p_total_points int,
  p_due_at       timestamptz,
  p_release_at   timestamptz,
  p_criteria     jsonb default null
) returns int language plpgsql set search_path = public as $$
declare
  r     record;
  label text;
  n     int := 0;
begin
  perform public.series_targets_check(p_targets);

  for r in
    select p.id, c.initial, c.section
      from public.projects p
      join public.classes c on c.id = p.class_id
     where p.id = any(p_targets)
     order by c.section
  loop
    label := r.initial || '  ·  ' || r.section;
    begin
      update public.projects set
        title        = btrim(p_title),
        type         = p_type,
        type_label   = case when p_type = 'other' then btrim(p_type_label) end,
        guidelines   = btrim(p_guidelines),
        start_week   = p_start_week,
        end_week     = p_end_week,
        total_points = p_total_points,
        due_at       = p_due_at,
        release_at   = p_release_at
      where id = r.id;
    exception when others then
      raise exception '% — %', label, sqlerrm;
    end;

    if p_criteria is not null then
      perform public.series_write_criteria(r.id, p_criteria);
    end if;
    n := n + 1;
  end loop;

  return n;
end;
$$;

-- ------------------------------------------------------------ one field

/**
 * The extension. Deliberately its own function rather than a trip through the
 * whole form: moving one section's deadline is the commonest thing a professor
 * does to a series, and it must be possible to do it for one section without
 * reading past four other steps that would then be saved to all of them.
 *
 * Like the lock, this does not reopen anything — a passed deadline marks work
 * late rather than blocking it, and that decision is unchanged.
 */
create or replace function public.set_series_due(p_targets uuid[], p_due timestamptz)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  perform public.series_targets_check(p_targets);
  update public.projects set due_at = p_due where id = any(p_targets);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.set_series_locked(p_targets uuid[], p_locked boolean)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  perform public.series_targets_check(p_targets);
  update public.projects
     set locked_at = case when p_locked then clock_timestamp() end
   where id = any(p_targets);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.set_series_archived(p_targets uuid[], p_archived boolean)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  perform public.series_targets_check(p_targets);
  update public.projects
     set archived_at = case when p_archived then clock_timestamp() end
   where id = any(p_targets);
  get diagnostics n = row_count;
  return n;
end;
$$;

/** Publishes scheduled sections now, which is what sends their notifications. */
create or replace function public.release_series_now(p_targets uuid[])
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  perform public.series_targets_check(p_targets);
  update public.projects set release_at = null where id = any(p_targets);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.series_targets_check(uuid[])        from public;
revoke all on function public.series_write_criteria(uuid, jsonb)  from public;

grant execute on function public.series_targets_check(uuid[])       to authenticated;
grant execute on function public.series_write_criteria(uuid, jsonb) to authenticated;
grant execute on function public.create_project_series(
  jsonb, text, public.project_type, text, text, int, int,
  public.project_audience, int, timestamptz, timestamptz, jsonb) to authenticated;
grant execute on function public.update_project_series(
  uuid[], text, public.project_type, text, text, int, int, int,
  timestamptz, timestamptz, jsonb) to authenticated;
grant execute on function public.set_series_due(uuid[], timestamptz)  to authenticated;
grant execute on function public.set_series_locked(uuid[], boolean)   to authenticated;
grant execute on function public.set_series_archived(uuid[], boolean) to authenticated;
grant execute on function public.release_series_now(uuid[])           to authenticated;

commit;
