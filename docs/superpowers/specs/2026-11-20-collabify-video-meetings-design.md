# Collabify video meetings — design

Date: 2026-11-20. Status: draft for owner approval.

## Intent

Meetings currently schedules a Zoom or Google Meet link for an audience Collabify already knows. People get a
notification and a calendar entry, but leave Collabify to talk. Add a video call inside Collabify while keeping
external meetings available. A forwarded Collabify link opens the right meeting, but the link alone grants no access.

## Decisions from the owner

| Topic | Decision |
| --- | --- |
| Hosting | The call stays inside Collabify; a managed video provider may carry media. |
| Provider | LiveKit Cloud. |
| Audiences | Keep all six: class, group, work space, work project, space team, project team. |
| Work project creators | Any project member, including a read-only stakeholder, may schedule or start its call. |
| Education creators | Faculty who teach a class may create whole-class calls; students may create calls only for their own group. Faculty retain today's ability to create a group call. |
| Capacity | Up to 100 people in one call. |
| Shareable link | Only signed-in people who currently belong to that meeting's audience may join. No outside guests. |
| Scheduled start | A host presses Start; the scheduled time alone never opens a room. |
| Host powers | The person who starts the call and the audience's existing leaders both have host controls. |
| Recording | A host chooses when to start it; every eligible audience member may watch it afterward; delete it after 30 days. |
| Chat | Keep in-call chat history after the call. |
| External providers | Default new meetings to Collabify; Zoom and Google Meet remain choices. Existing external meetings retain their links. |
| Layout | The owner accepted the browser mockup: video stage with speaker/grid choices, a chat side panel, a bottom control bar, a host menu and a clear recording indicator. |

## Goals

- From Meetings, schedule a Collabify call or start one now for any allowed audience. Calendar and notifications
  show it exactly as external meetings do.
- A scheduled meeting sends its usual schedule notice. When someone actually starts its call, notify its audience
  that the call is live, once. The starter does not receive their own notice.
- A signed-in audience member can open a shared link and join the call in Collabify. A membership change takes
  effect for new joins and for recordings and chat reads.
- Up to 100 people can join one call, with usable desktop, tablet and phone layouts.
- In a call: mic and camera on/off, browser share picker for one tab/window or whole screen, speaker/grid view
  (4/9/16 tiles and pagination), raise/lower hand, participant list, text chat, press-and-hold push to talk,
  device settings, background blur and a photo background. Show clear connection and recording state.
- Hosts can mute another person's mic, stop their screen share, remove a participant, lock new joins, start/stop
  recording and end the call for everyone. No host can remotely unmute or turn on another person's camera.
- Keep chat readable from the meeting afterward; make completed recordings available to the current audience
  for 30 days, then delete their bytes and metadata.

## Non-goals

- No anonymous or outside guest joining, phone dial-in, livestream, breakout rooms, whiteboard, polls, AI
  transcription, AI summary or auto-recording in this release.
- No recording of Zoom or Google Meet meetings. Collabify continues to store only their links and schedule.
- No recurring meeting series or reusable always-open rooms. Each scheduled meeting has at most one call run;
  after it ends, a new call needs a new meeting.
- No new admin dashboard for usage or recordings. Use provider billing alerts and existing operations first.

## Anti-goals

- A pasted or forwarded link must never bypass current class, group, space, project or team membership.
- A client must never receive a LiveKit API secret or a room-admin grant.
- A meeting must not show as live merely because its scheduled clock time arrived.
- A cancelled/ended/archived meeting cannot mint join tokens or restart a call.
- Read-only stakeholder permission to start a *meeting* must not grant task, file or project writes.
- The first 100-person class call must not subscribe every phone to 100 camera tracks at once.

## Approaches

- **LiveKit Cloud plus a Collabify call screen (picked).** Use its React room and track components, a server-side
  token endpoint, room management and Egress recording. Build Collabify's persistent chat and moderation rules on
  top. This fits the accepted screen, granular access and background effects. The tradeoff is more UI and provider
  integration work. [React components](https://docs.livekit.io/reference/components/react/),
  [token grants](https://docs.livekit.io/frontends/reference/tokens-grants/),
  [recording](https://docs.livekit.io/transport/media/ingress-egress/egress/).
- **Daily embedded or custom call UI (not picked).** Its prebuilt interface has prejoin, hand raising, chat,
  screenshare and recording, so a basic call ships faster. The requested push to talk, saved chat and precise
  Collabify layout still need custom work; an embed also gives less control over the screen.
  [Daily's feature options](https://docs.daily.co/docs/prebuilt/customizing-daily-prebuilt).
- **Self-hosted media (discarded).** It adds a 24-hour media/TURN deployment and its own reliability work to a
  Vercel plus Supabase product. The owner permits a managed provider.

## Current seams to reuse

- `src/pages/app/meetings/Meetings.tsx` already lists live/upcoming/past meetings, filters by place, opens details,
  and has Schedule and Start now. `ScheduleMeetingModal.tsx` chooses an existing audience and notifies on save.
- `supabase/meetings.sql` owns the base meeting table, six audience scopes, membership checks, RLS, list RPC,
  meeting notifications and calendar data. `src/pages/app/calendar/meetingDates.ts` maps those rows into Calendar.
- `supabase/project-stakeholders.sql` is the later owner of `create_meeting`, `meeting_audiences`,
  `meeting_can_manage`, `update_meeting` and `cancel_meeting`; it now refuses project stakeholders. The change
  is limited to meetings. `company-accounts.sql` is the later owner of `meeting_audience`. The final SQL owner
  order and `anon-lockdown.sql` must be preserved.
- `meeting_can_see` and `meeting_can_manage` are the starting point for call access and host rights. Group calls
  currently remain visible to their group and their creator; a teacher does not automatically enter a call a
  student started for a group. Keep that boundary.
- Existing Supabase Edge Functions show the signed-in caller pattern; Storage already has a scheduled API-based
  sweep pattern. New media credentials live only in Supabase secrets.

## User experience

### Meetings list and scheduler

- Keep the six audience choices. In the create/edit modal, choose **Collabify** by default or **Zoom/Google Meet**.
  For Collabify, do not ask for an external invitation or URL. For external meetings, keep today's link validation
  and invitation parsing. A meeting's provider is fixed after creation; changing it requires a new meeting.
- A scheduled Collabify row says **Scheduled** until a host starts it, regardless of the clock. The audience can
  open details and copy its Collabify link. The detail says **Waiting for a host** until it starts. Start opens
  prejoin first; the call is announced only after the starter actually connects.
- **Start now** chooses an audience and title, then opens prejoin. The user presses Start there; only then create
  and start the meeting. A person who closes prejoin has not notified anyone. Avoid duplicate meeting rows on retry.
- A member may copy the app link to email or Messenger. Opening it signs the person in if needed, then checks
  membership. A nonmember sees a plain refusal with no meeting details.
- Any currently eligible audience member may press Start on a scheduled call; the actual starter becomes a host.
  Whole-class Start remains faculty-only. Existing audience leaders are co-hosts: class faculty for a class,
  the designated student group leader for a student-created group call, and work-space/project managers and
  coordinators or their team leads where that audience has them. A teacher does not gain entry to a
  student-created group call merely by teaching its class. A scheduler does not gain host powers merely from
  scheduling if no longer in the audience.

### Prejoin and in-call screen

- Prejoin previews camera, mic and selected devices, supports speaker selection where the browser exposes it, and
  lets the person pick no background, blur, a supplied photo or a local photo (local-only, never uploaded).
  Remember device/background choices on that browser, with a working no-camera/no-mic path.
- Use the approved video stage with responsive speaker and paged grid views. On narrow phones show fewer live tiles
  per page; favor the active speaker or screen share. Keep the controls reachable without horizontal scrolling.
- The browser chooses which tab, window or display to share. Do not claim that Collabify can force a particular
  capture source; platform support varies. [LiveKit screen sharing](https://docs.livekit.io/transport/media/screenshare/).
- Push to talk is an explicit hold button on touch and pointer devices, plus Space when focus is outside text
  input and controls. Releasing returns to mute. It never overrides a host mute.
- Raise hand is visible in the participant list and on the person's tile. Lower it manually or when a host clears
  it. Keep hands as live room state, not permanent meeting history.
- The chat panel uses Collabify's database and realtime subscription, not LiveKit's ephemeral sample chat.
  Messages are readable by the meeting's current audience after the call and writable only during a live call.
- Settings can change mic, speaker, camera and background without leaving. If a background effect is unsupported
  or slow, the person keeps their normal camera rather than losing video.

### Host controls and end state

- The starter and current audience leaders may mute a mic, stop sharing, remove a participant, lock/unlock new
  joins, start/stop recording and end for everyone. Everyone else can leave only themselves. A removed person
  cannot rejoin that call; ordinary membership changes also remove an active participant when observed.
- Leaving does not end the call if others remain. End for everyone closes the LiveKit room, blocks new tokens and
  marks the meeting ended. A room that becomes empty is ended after a short grace period; a stale live state is
  reconciled against LiveKit. Warn before an eight-hour hard maximum and end the room then, matching today's
  maximum planned duration and containing runaway media cost. A call cannot restart after ending.
- Confirm recording start. Show an obvious recording indicator and an in-call notice to every participant, including
  late joiners. A host can stop and resume; the meeting can have multiple recorded segments. Finalizing and
  processing states are visible after the call. Failed recordings show an error, not a playable link. The school
  must review the recording notice and consent flow before release; the UI must never quietly start recording.
- After the call, meeting details offer chat history and recordings. The recording view disappears after 30 days;
  count from each segment's completion. Chat remains while the meeting record exists. Past Collabify meetings
  need paged history beyond today's 30-day list window so saved chat stays findable. New audience members can
  read old chat/recordings; former members immediately lose the ability to fetch chat or obtain new playback
  URLs. Already-issued playback URLs expire within 60 seconds. This follows current audience membership rather
  than a fixed invite list.

## Data and service design

- Extend `meeting_platform` with `collabify`. Internal meetings have no external `join_url`; keep URLs and
  constraints for Zoom/Google Meet rows. Add actual `started_at`, `started_by`, `ended_at` and room state;
  scheduled time and planned duration remain calendar fields, not proof a call is running.
- Keep one opaque LiveKit room name per meeting run. The room name and link are identifiers, never credentials.
  Enforce 100 participants at the provider and on the join path. Keep a small removal/ban record for this run
  if a host ejects someone.
- New SQL transitions are atomic and idempotent: create internal meeting, begin starting, mark live, end,
  lock/unlock, record metadata and chat writes. Preserve current six-audience membership helpers and recheck
  role/status/archive state for each transition. Only one start wins. A host receives a token during a short
  `starting` state; a verified first media connection marks the call live and creates a distinct
  `meeting_started` notification. A failed prejoin or connection must not announce a live call. The existing
  schedule, change and cancel notices remain correct.
- A signed-in Supabase Edge Function verifies the caller, checks the live meeting and current audience in the
  database, then mints a short-lived LiveKit room-join token for that user's profile ID. It never trusts a scope,
  room or role supplied by the browser. API credentials stay in Supabase secrets. Host operations go through a
  separate server check of the call-host predicate, which includes the starter and current audience leaders;
  client tokens have no room-admin grant. [LiveKit's server
  SDK supports Deno](https://docs.livekit.io/reference/server-sdk-js/).
- LiveKit room/participant and Egress webhooks are signature-verified and processed idempotently. Webhook delivery
  is not guaranteed, so list/join paths and a scheduled reconciler correct stale live/recording state.
  [LiveKit webhooks](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/).
- Use a private Supabase Storage bucket for video recordings, with paths tied to meeting and segment IDs. LiveKit
  Egress supports S3-compatible output and a custom endpoint; Supabase Storage supports the S3 protocol. Prove
  this exact upload combination in an isolated integration check before committing to it; if incompatible, use a
  private S3 bucket with the same access and deletion contract. Never expose bucket credentials.
  [LiveKit Egress S3 output](https://docs.livekit.io/reference/other/egress/api/),
  [Supabase S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility).
- Recordings are never public objects. Playback requires the viewer's current meeting-audience authorization.
  A daily job deletes expired video objects through a storage API and removes their rows. Retry failures and
  surface them in logs; a row cannot claim an object was deleted while bytes remain.
- New in-call chat rows have meeting ID, sender, body and server timestamp. RLS reads follow
  `meeting_can_see`; writes require live state and audience membership. Keep chat after video expiry, but delete
  it when the parent meeting itself is permanently deleted.

## Operations, rollout and verification

- LiveKit Cloud's current free plan allows 100 concurrent connections and 5,000 WebRTC minutes; a single
  100-person, one-hour call uses 6,000 participant minutes. Budget for a paid plan and set usage alerts before
  enabling 100-person calls. Recording and downstream traffic also consume provider and Storage quotas.
  [LiveKit pricing](https://livekit.com/pricing).
- Roll out behind a server-controlled feature flag: old external meetings continue to work. Apply SQL in the
  documented restore order, re-run later function owners, and run `anon-lockdown.sql` last. Deploy Edge Functions
  and LiveKit webhook settings before showing Collabify as an option. Put the secrets only in Supabase.
- SQL suites cover every scope and role, including a student refused from whole-class calls, a student allowed
  for their own group, a stakeholder allowed for their project, nonmembers/former members refused, archived and
  cancelled meetings refused, host-only controls, duplicate starts, lock/ban and chat/recording RLS. Existing
  Zoom/Google tests remain green.
- Frontend checks cover list status, deep links, prejoin without devices, reconnect, controls, chat and recording
  states, and narrow phone layout. Run `npm run check`, the SQL suites, schema drift and an end-to-end browser
  walk with separate project, class and group accounts. Test a real 100-person call or a provider load simulation
  before declaring that capacity ready.
- Verify recording upload, audience-only playback, 30-day deletion, egress failure recovery, notification-on-start
  once, provider billing alerts, the school's recording notice/consent decision and late membership revocation
  before production release.

## Builder decisions left open

- Choose the smallest LiveKit React components needed for the accepted mockup, and adapt them to Collabify tokens.
- Choose the exact database column/table split and function names while preserving the behavior above and SQL
  re-run order. Keep the external meeting path working throughout the rollout.
- Choose an empty-room grace period and background photo presets. These do not change who can join or what is
  stored.
