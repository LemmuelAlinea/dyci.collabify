-- Collabify — a professor can still see who they removed.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/removed-visible.sql

begin;

/**
 * Names are shared between people in the same class, and between a professor
 * and their students.
 *
 * The professor half deliberately ignores membership status: removing a
 * student used to hide their name from the professor who removed them, which
 * emptied the removed list and left no way to put anyone back.
 */
create or replace function public.shares_class_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.class_members me
      join public.class_members them on them.class_id = me.class_id
      join public.classes c on c.id = me.class_id
     where me.student_id = auth.uid() and me.status = 'active'
       and them.student_id = p_user and them.status = 'active'
       and c.archived_at is null
    union all
    select 1
      from public.classes c
      join public.class_members m on m.class_id = c.id
     where (c.professor_id = auth.uid() and m.student_id = p_user)
        or (c.professor_id = p_user and m.student_id = auth.uid() and m.status = 'active')
  );
$$;

commit;
