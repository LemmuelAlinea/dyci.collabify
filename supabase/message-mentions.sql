-- supabase/message-mentions.sql
-- Task and project mentions in the Inbox.
--
-- A mention is a code in messages.body: #[t:<id>] work task, #[p:<id>] work
-- project, #[ct:<id>] class task copy, #[co:<origin>] class set task (each
-- reader opens their own copy), #[cp:<id>] class project. No title is stored;
-- each reader's app reads titles under row security and shows a locked chip
-- for anything that comes back empty.
--
-- search_mentionables runs as the caller, so row security decides what they
-- can read, and only offers what they are on: work projects they are a member
-- of, classes they are in or teach, and the tasks inside those. Archived and
-- trashed items are left out. The conversation's own place ranks first.
--
-- mention_blind_spots is the writer's note ("they'll see a locked chip"): for
-- refs the caller can reach, how many chat members are not on its project or
-- board. Counts only, never names.
--
-- Runs after active-status.sql and before anon-lockdown.sql. Redefines nothing
-- another file owns. Idempotent.
-- Suite: supabase/tests/message-mentions.test.sql

begin;

-- ---------------------------------------------------------------- search

create or replace function public.search_mentionables(p_query text, p_conversation uuid)
returns table (kind text, id uuid, title text, project_id uuid, project_title text)
language sql stable security invoker set search_path = public as $$
  with place as (
    select c.general_project_id as work_project,
           coalesce(c.class_id, gs.class_id) as class_id
      from public.conversations c
      left join public.groups g on g.id = c.group_id
      left join public.group_sets gs on gs.id = g.set_id
     where c.id = p_conversation
       and exists (select 1 from public.conversation_members cm
                    where cm.conversation_id = c.id and cm.user_id = auth.uid())
  ),
  pattern as (
    select '%' || replace(replace(replace(coalesce(btrim(p_query), ''),
             '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
  ),
  work_projects as (
    select gp.id, gp.name, gp.updated_at
      from public.general_projects gp
     where gp.class_board_id is null
       and gp.archived_at is null
       and exists (select 1 from public.general_members m
                    where m.project_id = gp.id and m.user_id = auth.uid())
  ),
  my_classes as (
    select c.id
      from public.classes c
     where c.archived_at is null
       and (exists (select 1 from public.class_members m
                     where m.class_id = c.id and m.student_id = auth.uid() and m.status = 'active')
            or public.is_class_professor(c.id))
  ),
  class_projects as (
    select p.id, p.title, p.class_id, p.updated_at
      from public.projects p
     where p.archived_at is null
       and p.class_id in (select id from my_classes)
  ),
  class_tasks as (
    select pt.id, pt.origin_id, pt.title, pt.updated_at, cp.id as project_id, cp.title as project_title,
           cp.class_id
      from public.project_tasks pt
      join public.project_boards b on b.id = pt.board_id
      join class_projects cp on cp.id = b.project_id
     where pt.archived_at is null
  ),
  found (kind, id, title, project_id, project_title, updated_at, here) as (
    select 'p', w.id, w.name, w.id, w.name, w.updated_at,
           w.id = (select work_project from place)
      from work_projects w
    union all
    select 't', t.id, t.title, w.id, w.name, t.updated_at,
           w.id = (select work_project from place)
      from public.general_tasks t
      join work_projects w on w.id = t.project_id
     where t.archived_at is null
    union all
    select 'cp', cp.id, cp.title, cp.id, cp.title, cp.updated_at,
           cp.class_id = (select class_id from place)
      from class_projects cp
    union all
    select 'ct', ct.id, ct.title, ct.project_id, ct.project_title, ct.updated_at,
           ct.class_id = (select class_id from place)
      from class_tasks ct
     where ct.origin_id is null
    union all
    select * from (
      select distinct on (ct.origin_id)
             'co', ct.origin_id, ct.title, ct.project_id, ct.project_title, ct.updated_at,
             ct.class_id = (select class_id from place)
        from class_tasks ct
       where ct.origin_id is not null
       order by ct.origin_id, ct.updated_at desc
    ) as set_tasks
  )
  select f.kind, f.id, f.title, f.project_id, f.project_title
    from found f
   where exists (select 1 from place)
     and f.title ilike (select p from pattern)
   order by coalesce(f.here, false) desc, f.updated_at desc
   limit 8;
$$;

-- ---------------------------------------------------------------- who is on what (internal)

/** Whether p_user teaches p_class: an active professor or co-teacher (class_teacher_ids). */
create or replace function public.mention_teaches(p_class uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user in (select public.class_teacher_ids(p_class))
     and exists (select 1 from public.profiles p where p.id = p_user and p.status = 'active');
$$;

/** Whether p_user is in p_class as an active student or teaches it. */
create or replace function public.mention_in_class(p_class uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.class_members m
                  where m.class_id = p_class and m.student_id = p_user and m.status = 'active')
      or public.mention_teaches(p_class, p_user);
$$;

/**
 * Whether p_user can read class project p_project: projects_select, for any
 * person. Teachers read it; a student reads it only while it is live and
 * released, and a group project only when they are in its group set.
 */
create or replace function public.mention_reads_class_project(p_project uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
     where p.id = p_project
       and (public.mention_teaches(p.class_id, p_user)
            or (exists (select 1 from public.class_members m
                         where m.class_id = p.class_id and m.student_id = p_user and m.status = 'active')
                and p.archived_at is null
                and (p.release_at is null or p.release_at <= now())
                and (p.group_set_id is null
                     or exists (select 1 from public.group_members gm
                                 where gm.set_id = p.group_set_id and gm.student_id = p_user)))));
$$;

/** Whether p_user works on p_board: its student, or a member of its group. */
create or replace function public.mention_on_board(p_board uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_boards b
     where b.id = p_board
       and (b.student_id = p_user
            or exists (select 1 from public.group_members gm
                        where gm.group_id = b.group_id and gm.student_id = p_user)));
$$;

revoke all on function public.mention_teaches(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mention_in_class(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mention_on_board(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mention_reads_class_project(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the writer's note

/**
 * For each ref the caller can reach, how many other people in the chat could
 * not open it, by the same read rules the app uses (projects_select and
 * can_see_board for class work). Counts only: no title is returned, so a uuid
 * from someone else's mention tells the caller nothing they can't already read.
 */
drop function if exists public.mention_blind_spots(uuid, jsonb);
create function public.mention_blind_spots(p_conversation uuid, p_refs jsonb)
returns table (kind text, id uuid, members_without int, private_task boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  me        uuid := auth.uid();
  ref       record;
  v_project uuid;
  v_class   uuid;
  v_board   uuid;
  v_state   text;
  reach     boolean;
begin
  if me is null or not exists (select 1 from public.conversation_members cm
                                where cm.conversation_id = p_conversation and cm.user_id = me) then
    raise exception 'You are not in this chat' using errcode = 'insufficient_privilege';
  end if;
  if p_refs is null or jsonb_typeof(p_refs) <> 'array' or jsonb_array_length(p_refs) > 10 then
    raise exception 'Send up to 10 mentions' using errcode = 'check_violation';
  end if;

  for ref in
    select distinct e->>'kind' as k, (e->>'id')::uuid as rid from jsonb_array_elements(p_refs) e
  loop
    v_project := null; v_class := null; v_board := null; v_state := null; reach := false;

    if ref.k = 't' then
      select t.project_id, t.routing_state into v_project, v_state
        from public.general_tasks t
        join public.general_projects p on p.id = t.project_id and p.class_board_id is null
       where t.id = ref.rid and t.archived_at is null and p.archived_at is null;
      reach := v_project is not null
           and exists (select 1 from public.general_members m where m.project_id = v_project and m.user_id = me)
           and public.general_task_child_readable(ref.rid);
    elsif ref.k = 'p' then
      select p.id into v_project
        from public.general_projects p
       where p.id = ref.rid and p.class_board_id is null and p.archived_at is null;
      reach := v_project is not null
           and exists (select 1 from public.general_members m where m.project_id = v_project and m.user_id = me);
    elsif ref.k = 'cp' then
      select p.id, p.class_id into v_project, v_class
        from public.projects p join public.classes c on c.id = p.class_id
       where p.id = ref.rid and p.archived_at is null and c.archived_at is null;
      reach := v_project is not null and public.mention_reads_class_project(v_project, me);
    elsif ref.k = 'ct' then
      select p.id, p.class_id, b.id into v_project, v_class, v_board
        from public.project_tasks pt
        join public.project_boards b on b.id = pt.board_id
        join public.projects p on p.id = b.project_id
        join public.classes c on c.id = p.class_id
       where pt.id = ref.rid and pt.archived_at is null and p.archived_at is null and c.archived_at is null;
      reach := v_board is not null
           and (public.mention_teaches(v_class, me)
                or (public.mention_on_board(v_board, me) and public.project_is_live(v_project)));
    elsif ref.k = 'co' then
      select p.id, p.class_id into v_project, v_class
        from public.project_tasks pt
        join public.project_boards b on b.id = pt.board_id
        join public.projects p on p.id = b.project_id
        join public.classes c on c.id = p.class_id
       where pt.origin_id = ref.rid and pt.archived_at is null and p.archived_at is null and c.archived_at is null
       limit 1;
      reach := v_class is not null
           and (public.mention_teaches(v_class, me)
                or (public.project_is_live(v_project)
                    and exists (select 1 from public.project_tasks pt
                                 where pt.origin_id = ref.rid and pt.archived_at is null
                                   and public.mention_on_board(pt.board_id, me))));
    end if;

    if not reach then
      raise exception 'You can only mention tasks and projects you are on'
        using errcode = 'insufficient_privilege';
    end if;

    kind := ref.k;
    id := ref.rid;
    private_task := ref.k = 't' and v_state <> 'released';
    select count(*)::int into members_without
      from public.conversation_members cm
     where cm.conversation_id = p_conversation
       and cm.user_id <> me
       and not case ref.k
         when 't' then exists (select 1 from public.general_members m where m.project_id = v_project and m.user_id = cm.user_id)
         when 'p' then exists (select 1 from public.general_members m where m.project_id = v_project and m.user_id = cm.user_id)
         when 'cp' then public.mention_reads_class_project(v_project, cm.user_id)
         when 'ct' then public.mention_teaches(v_class, cm.user_id)
                        or (public.mention_on_board(v_board, cm.user_id) and public.project_is_live(v_project))
         else public.mention_teaches(v_class, cm.user_id)
              or (public.project_is_live(v_project)
                  and exists (select 1 from public.project_tasks pt
                               where pt.origin_id = ref.rid and pt.archived_at is null
                                 and public.mention_on_board(pt.board_id, cm.user_id)))
       end;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.search_mentionables(text, uuid) from public, anon;
revoke all on function public.mention_blind_spots(uuid, jsonb) from public, anon;
grant execute on function public.search_mentionables(text, uuid) to authenticated;
grant execute on function public.mention_blind_spots(uuid, jsonb) to authenticated;

commit;
