-- Device push (docs/superpowers/specs/2026-11-11-device-push-design.md).
--
-- Every notification row is also sent to OneSignal for its recipient, whose devices are linked by
-- user id (OneSignal.login in src/lib/push.ts). The existing notification_prefs switches already
-- decide which rows get written, so a push follows the same choice.
--
-- The REST API key lives only in the Vault, as `collabify_onesignal_rest_key`; without it the
-- trigger does nothing. pg_net queues the request, so the insert never waits on OneSignal, and any
-- failure is a warning, never an error: a push must not block the change that notified.
--
-- Nothing earlier owns this trigger or function, so no other file's rerun means re-running this
-- one. It runs before anon-lockdown.sql.

begin;

create extension if not exists pg_net;

create or replace function public.send_notification_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'collabify_onesignal_rest_key';
  if v_key is null or btrim(v_key) = '' then
    return null;
  end if;

  perform net.http_post(
    url     := 'https://api.onesignal.com/notifications',
    headers := jsonb_build_object(
                 'Authorization', 'Key ' || btrim(v_key),
                 'Content-Type', 'application/json'),
    body    := jsonb_build_object(
                 'app_id', 'f3a232e0-d87f-4ddf-9da5-40b0e65d22ac',
                 'target_channel', 'push',
                 'include_aliases', jsonb_build_object('external_id', jsonb_build_array(new.user_id::text)),
                 'headings', jsonb_build_object('en', left(new.title, 120)),
                 'contents', jsonb_build_object('en',
                   left(coalesce(nullif(btrim(new.preview), ''), new.title), 400)),
                 -- /n/<id> marks it read and opens the page the bell would.
                 'url', 'https://dyci-collabify.vercel.app/n/' || new.id,
                 -- One push per notification, even if a request is ever retried.
                 'idempotency_key', new.id::text),
    timeout_milliseconds := 10000);
  return null;
exception when others then
  raise warning 'device push skipped for notification %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.send_notification_push() from public, anon, authenticated;

drop trigger if exists notifications_z_push on public.notifications;
create trigger notifications_z_push
  after insert on public.notifications
  for each row execute function public.send_notification_push();

commit;
