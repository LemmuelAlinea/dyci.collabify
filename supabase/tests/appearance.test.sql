-- Each person's own colours: private, well-formed, and capped. Rolls back.
--
--   node scripts/db.mjs supabase/tests/appearance.test.sql
begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_true, false) then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  me      uuid := gen_random_uuid();
  other   uuid := gen_random_uuid();
  good    jsonb := '{"light": {"banner": "#123456", "success": "#00aa55"}, "dark": {"badge": "#ffcc00"}}';
  pal     uuid;
  n       int;
  refused boolean;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Colour', 'last_name', v.ln, 'role', 'student'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (me, 'appearance-me@test.local', 'Me'),
                 (other, 'appearance-other@test.local', 'Other')) as v(id, em, ln);

  -- ------------------------------------------------------------ in use now
  perform pg_temp.act_as(me);
  insert into public.user_appearance (colors) values (good);
  select count(*) into n from public.user_appearance where user_id = me;
  perform pg_temp.ok('the owner saves their colours, keyed to them by default', n = 1);

  update public.user_appearance set colors = '{"light": {"progress": "#abcdef"}}' where user_id = me;
  select count(*) into n from public.user_appearance
   where user_id = me and colors #>> '{light,progress}' = '#abcdef';
  perform pg_temp.ok('the owner changes them', n = 1);

  refused := false;
  begin
    update public.user_appearance set colors = '{"light": {"page": "#ffffff"}}' where user_id = me;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a key outside the list is refused', refused);

  refused := false;
  begin
    update public.user_appearance set colors = '{"light": {"banner": "red; background: url(x)"}}'
     where user_id = me;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a value that is not a hex colour is refused', refused);

  refused := false;
  begin
    update public.user_appearance set colors = '{"sepia": {}}' where user_id = me;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a mode other than light or dark is refused', refused);

  update public.user_appearance
     set colors = '{"light": {"bannerStyle": "gradient", "banner2": "#223344", "iconTile": "#101010", "iconGlyph": "#ffcc00"},
                    "dark": {"bannerStyle": "solid", "depth": 100}}'
   where user_id = me;
  select count(*) into n from public.user_appearance
   where user_id = me and colors #>> '{dark,depth}' = '100';
  perform pg_temp.ok('banner style, second banner colour, card icons and depth save', n = 1);

  refused := false;
  begin
    update public.user_appearance set colors = '{"light": {"bannerStyle": "plaid"}}' where user_id = me;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a banner style outside glow, solid and gradient is refused', refused);

  refused := false;
  begin
    update public.user_appearance set colors = '{"light": {"depth": 50}}' where user_id = me;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('depth is refused for light mode', refused);

  refused := false;
  begin
    update public.user_appearance set colors = '{"dark": {"depth": 150}}' where user_id = me;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a depth past 100 is refused', refused);

  refused := false;
  begin
    update public.user_appearance set colors = '{"dark": {"depth": "50; color: red"}}' where user_id = me;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a depth that is not a number is refused', refused);

  refused := false;
  begin
    update public.user_appearance set colors = '{"dark": {"depth": 12.5}}' where user_id = me;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a depth that is not a whole number is refused', refused);

  perform pg_temp.act_as(other);
  select count(*) into n from public.user_appearance;
  perform pg_temp.ok('someone else sees none of it', n = 0);

  update public.user_appearance set colors = '{}' where user_id = me;
  get diagnostics n = row_count;
  perform pg_temp.ok('someone else cannot change it', n = 0);

  refused := false;
  begin
    insert into public.user_appearance (user_id, colors) values (me, '{}');
  exception when insufficient_privilege or unique_violation then refused := true;
  end;
  perform pg_temp.ok('someone else cannot write a row for the owner', refused);

  -- ------------------------------------------------------------ saved palettes
  perform pg_temp.act_as(me);
  insert into public.appearance_palettes (name, colors) values ('  Mine  ', good) returning id into pal;
  select count(*) into n from public.appearance_palettes where id = pal and name = 'Mine' and user_id = me;
  perform pg_temp.ok('a palette saves under a trimmed name', n = 1);

  refused := false;
  begin
    insert into public.appearance_palettes (name, colors) values ('mine', good);
  exception when unique_violation then refused := true;
  end;
  perform pg_temp.ok('a second palette with the same name is refused', refused);

  refused := false;
  begin
    insert into public.appearance_palettes (name, colors) values ('   ', good);
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a blank name is refused', refused);

  refused := false;
  begin
    insert into public.appearance_palettes (name, colors) values ('Bad', '{"light": {"banner": "#12345"}}');
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a palette with a malformed colour is refused', refused);

  update public.appearance_palettes set name = 'Evening' where id = pal;
  select count(*) into n from public.appearance_palettes where id = pal and name = 'Evening';
  perform pg_temp.ok('the owner renames a palette', n = 1);

  insert into public.appearance_palettes (name, colors)
  select 'Palette ' || g, '{}'::jsonb from generate_series(2, 12) g;
  select count(*) into n from public.appearance_palettes where user_id = me;
  perform pg_temp.ok('twelve palettes fit', n = 12);

  refused := false;
  begin
    insert into public.appearance_palettes (name, colors) values ('Thirteen', '{}');
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('the thirteenth is refused', refused);

  perform pg_temp.act_as(other);
  select count(*) into n from public.appearance_palettes;
  perform pg_temp.ok('someone else sees none of the palettes', n = 0);

  delete from public.appearance_palettes where id = pal;
  get diagnostics n = row_count;
  perform pg_temp.ok('someone else cannot delete one', n = 0);

  insert into public.appearance_palettes (name, colors) values ('Evening', good);
  select count(*) into n from public.appearance_palettes where user_id = other;
  perform pg_temp.ok('names are per person: someone else can use the same one', n = 1);

  perform pg_temp.act_as(me);
  refused := false;
  begin
    update public.appearance_palettes set user_id = other where id = pal;
  exception when insufficient_privilege or check_violation then refused := true;
  end;
  perform pg_temp.ok('a palette cannot be handed to someone else', refused);

  delete from public.appearance_palettes where id = pal;
  get diagnostics n = row_count;
  perform pg_temp.ok('the owner deletes a palette', n = 1);

  perform pg_temp.act_as_service();
  delete from auth.users where id = me;
  select count(*) into n from public.appearance_palettes where user_id = me;
  perform pg_temp.ok('deleting the account takes the palettes with it', n = 0);
  select count(*) into n from public.user_appearance where user_id = me;
  perform pg_temp.ok('and the colours in use', n = 0);
end;
$$;

rollback;
