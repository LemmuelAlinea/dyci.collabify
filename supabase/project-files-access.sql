-- Work-project Members can commit to Main without a separate grant.
-- Run after project-roles.sql and project-stakeholders.sql, then anon-lockdown.sql.
-- Reapply after general.sql or project-roles.sql, which own earlier definitions.

begin;

create or replace function public.general_has(
  p_project uuid,
  p_permission public.general_permission
) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.general_projects gp
                  where gp.id = p_project and gp.class_board_id is null) then
      coalesce(public.is_general_member(p_project) and (
        case public.general_role_of(p_project, auth.uid())
          when 'pm' then true
          when 'coordinator' then p_permission <> 'edit_project'
          when 'member' then p_permission = 'commit_main' or exists (
            select 1 from public.general_grants g
             where g.project_id = p_project and g.user_id = auth.uid()
               and g.permission = p_permission
          )
          else false
        end
      ), false)
    else
      public.is_general_member(p_project) and (
        exists (
          select 1 from public.general_members m
           where m.project_id = p_project and m.user_id = auth.uid()
             and m.level in ('owner', 'manager')
        )
        or exists (
          select 1 from public.general_grants g
           where g.project_id = p_project and g.user_id = auth.uid()
             and g.permission = p_permission
        )
        or (p_permission = 'commit_main' and public.general_class_commit_ok(p_project))
      )
  end;
$$;

create or replace function public.general_commit_rights(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_group  uuid;
  v_solo   uuid;
  v_leader uuid;
  v_board  boolean;
  who      uuid[];
begin
  if not public.is_general_member(p_project) then
    return jsonb_build_object('commit', false, 'grant', false, 'board', false, 'committers', '[]'::jsonb);
  end if;
  select b.group_id, b.student_id, g.leader_id, gp.class_board_id is not null
    into v_group, v_solo, v_leader, v_board
    from public.general_projects gp
    left join public.project_boards b on b.id = gp.class_board_id
    left join public.groups g on g.id = b.group_id
   where gp.id = p_project;

  select coalesce(array_agg(m.user_id), '{}') into who
    from public.general_members m
    join public.profiles profile on profile.id = m.user_id and profile.status <> 'rejected'
   where m.project_id = p_project
     and (
       (not v_board and m.role in ('pm', 'coordinator', 'member'))
       or (v_board and (
         m.level in ('owner', 'manager')
         or exists (select 1 from public.general_grants g
                     where g.project_id = p_project and g.user_id = m.user_id and g.permission = 'commit_main')
         or m.user_id = v_solo
         or (v_group is not null and (v_leader is null or v_leader = m.user_id))
       ))
     );

  return jsonb_build_object(
    'commit', public.general_can(p_project, 'commit_main'),
    'grant', public.general_can_grant(p_project, 'commit_main') and not public.general_is_archived(p_project),
    'board', coalesce(v_board, false),
    'committers', to_jsonb(who)
  );
end;
$$;

-- Commits, blobs, and repository state are written by security-definer RPCs.
-- Direct table writes would bypass their sequence and file validation.
drop policy if exists general_repos_write on public.general_repos;
drop policy if exists general_commits_insert on public.general_commits;
drop policy if exists general_blobs_insert on public.general_blobs;

revoke all on function public.general_has(uuid, public.general_permission) from public, anon;
revoke all on function public.general_commit_rights(uuid) from public, anon;
grant execute on function public.general_has(uuid, public.general_permission) to authenticated;
grant execute on function public.general_commit_rights(uuid) to authenticated;

commit;
