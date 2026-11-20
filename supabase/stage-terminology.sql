-- User-facing names for dated work cycles. Existing cycle names are never rewritten.
alter table public.general_sprint_settings
  add column if not exists term_singular text not null default 'Stage',
  add column if not exists term_plural text not null default 'Stages';

alter table public.project_boards
  add column if not exists term_singular text not null default 'Stage',
  add column if not exists term_plural text not null default 'Stages';

do $$ begin
  alter table public.general_sprint_settings add constraint general_sprint_term_valid
    check (length(term_singular) between 1 and 24 and term_singular = btrim(term_singular)
      and length(term_plural) between 1 and 24 and term_plural = btrim(term_plural)
      and term_singular ~ '^[[:alpha:]][[:alpha:] -]*$'
      and term_plural ~ '^[[:alpha:]][[:alpha:] -]*$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.project_boards add constraint board_stage_term_valid
    check (length(term_singular) between 1 and 24 and term_singular = btrim(term_singular)
      and length(term_plural) between 1 and 24 and term_plural = btrim(term_plural)
      and term_singular ~ '^[[:alpha:]][[:alpha:] -]*$'
      and term_plural ~ '^[[:alpha:]][[:alpha:] -]*$');
exception when duplicate_object then null; end $$;

create or replace function public.set_board_stage_terms(
  p_board uuid, p_singular text, p_plural text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  b record;
begin
  if auth.uid() is null then
    raise exception 'Sign in to change the board label.' using errcode = 'insufficient_privilege';
  end if;

  p_singular := btrim(p_singular);
  p_plural := btrim(p_plural);
  if p_singular is null or p_plural is null
     or length(p_singular) not between 1 and 24
     or length(p_plural) not between 1 and 24
     or p_singular !~ '^[[:alpha:]][[:alpha:] -]*$'
     or p_plural !~ '^[[:alpha:]][[:alpha:] -]*$' then
    raise exception 'Use a singular and plural name of 1 to 24 characters.' using errcode = 'check_violation';
  end if;

  select b0.id, b0.group_id, b0.student_id, b0.submitted_at, p.class_id, p.locked_at,
         p.archived_at, c.archived_at as class_archived_at,
         g.leader_id, g.archived_at as group_archived_at,
         s.closed_at as set_closed_at
    into b
    from public.project_boards b0
    join public.projects p on p.id = b0.project_id
    join public.classes c on c.id = p.class_id
    left join public.groups g on g.id = b0.group_id
    left join public.group_sets s on s.id = g.set_id
   where b0.id = p_board
   for update of b0;

  if not found then
    raise exception 'That board no longer exists.' using errcode = 'no_data_found';
  end if;
  if b.submitted_at is not null or b.locked_at is not null or b.archived_at is not null
     or b.class_archived_at is not null or b.group_archived_at is not null
     or b.set_closed_at is not null then
    raise exception 'This board is closed. Reopen it before changing the label.' using errcode = 'check_violation';
  end if;
  if not (public.is_class_professor(b.class_id)
          or coalesce(b.student_id = auth.uid(), false)
          or coalesce(b.leader_id = auth.uid() and public.is_group_member(b.group_id), false)) then
    raise exception 'Only the group leader, board owner or teaching faculty can change this label.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.project_boards
     set term_singular = p_singular, term_plural = p_plural
   where id = p_board;
end;
$$;

revoke all on function public.set_board_stage_terms(uuid, text, text) from public, anon;
grant execute on function public.set_board_stage_terms(uuid, text, text) to authenticated;
