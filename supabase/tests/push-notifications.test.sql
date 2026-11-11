-- supabase/tests/push-notifications.test.sql
-- Device push: no key means no request; with a key, one OneSignal request per notification,
-- aimed at the recipient's user id and opening /n/<id>. Rolls back; nothing survives, and no
-- request leaves (pg_net only sends what a committed transaction queued).
--   node scripts/db.mjs supabase/tests/push-notifications.test.sql
begin;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_user  uuid := (select id from public.profiles order by created_at limit 1);
  v_before bigint := (select count(*) from net.http_request_queue);
  v_id    uuid;
  v_body  jsonb;
  v_head  jsonb;
begin
  perform pg_temp.must_be('push trigger is installed',
    exists (select 1 from pg_trigger where tgname = 'notifications_z_push'
             and tgrelid = 'public.notifications'::regclass));

  -- Without the Vault key nothing is queued. (Removed for this transaction only.)
  delete from vault.secrets where name = 'collabify_onesignal_rest_key';
  insert into public.notifications (user_id, type, title, preview)
  values (v_user, 'nudge', 'No key yet', 'Should not leave');
  perform pg_temp.must_be('no key: no request',
    (select count(*) from net.http_request_queue) = v_before);

  -- With a key, one request per row.
  perform vault.create_secret('test-key', 'collabify_onesignal_rest_key');
  insert into public.notifications (user_id, type, title, preview)
  values (v_user, 'nudge', 'Task assigned', '') returning id into v_id;
  perform pg_temp.must_be('key: one request',
    (select count(*) from net.http_request_queue) = v_before + 1);

  select convert_from(q.body, 'utf8')::jsonb, q.headers into v_body, v_head
    from net.http_request_queue q
   where q.url = 'https://api.onesignal.com/notifications'
   order by q.id desc limit 1;

  perform pg_temp.must_be('aimed at the recipient',
    v_body -> 'include_aliases' -> 'external_id' = jsonb_build_array(v_user::text));
  perform pg_temp.must_be('push channel only', v_body ->> 'target_channel' = 'push');
  perform pg_temp.must_be('opens /n/<id>',
    v_body ->> 'url' = 'https://dyci-collabify.vercel.app/n/' || v_id);
  perform pg_temp.must_be('empty preview falls back to the title',
    v_body -> 'contents' ->> 'en' = 'Task assigned');
  perform pg_temp.must_be('one push per notification', v_body ->> 'idempotency_key' = v_id::text);
  perform pg_temp.must_be('key sent as header', v_head ->> 'Authorization' = 'Key test-key');

  perform pg_temp.must_be('people cannot call the sender',
    not has_function_privilege('authenticated', 'public.send_notification_push()', 'execute'));
end;
$$;

rollback;
