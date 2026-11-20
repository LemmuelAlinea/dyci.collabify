# Collabify video meetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let eligible Collabify members schedule, start, join, moderate and record video calls inside Meetings, with saved chat and 30-day recordings, while retaining Zoom and Google Meet meetings.

**Architecture:** The existing meeting row and six audience checks stay the source of truth. Supabase stores call state, chat and recording metadata; authenticated Edge Functions grant short-lived, room-specific LiveKit Cloud access and perform provider operations. The Meetings page adds a Collabify call route and a room UI. A server-side flag hides the new option until the provider, storage, tests and school recording notice are ready.

**Tech Stack:** React 19, TypeScript, Vite, React Router, Supabase/Postgres/Edge Functions/Storage, LiveKit Cloud, LiveKit React components and SDKs, Vitest, SQL suites.

**Spec:** `docs/superpowers/specs/2026-11-20-collabify-video-meetings-design.md`.

## Global Constraints

- Keep all six scopes: `class`, `group`, `space`, `project`, `space_team`, `project_team`. Whole-class creation/start is teaching faculty only; students create/start only for their own group; work-project stakeholders may create/start meetings.
- A room holds at most 100 people. Actual call duration has an eight-hour hard maximum. A scheduled room opens only after an eligible member starts and connects.
- Shareable links never grant access. Every join, host action, chat read/write and recording read checks current membership and active account status. No outside guests.
- Host rights belong to the starter and current audience leaders; no client token has a room-admin grant. No one can remotely turn on another person's mic or camera.
- Recording is host-started, visibly announced, private to the current audience and deleted 30 days after each segment finishes. Chat remains while the meeting record exists.
- Collabify is the default for new meetings; existing and new Zoom/Google Meet links keep working. Existing meeting URLs and old clients must not break during rollout.
- LiveKit API, webhook, S3 and service credentials stay in Supabase secrets/Vault, never browser code, Vercel, output, or Git. Do not read or print `.env.local`.
- SQL stays idempotent. Register `meeting-calls.sql` in the restore line and schema-drift order after existing final owners; re-run any superseding owners in order, and `anon-lockdown.sql` last after function changes.
- Use `src/lib/paths.ts` for URLs, tokens from `src/styles/index.css` for colors, sentence-case active copy, reduced-motion handling, and real desktop/tablet/phone layouts.
- Stage only named files. Never stage `.superpowers/`, `graphify-out/`, `supabase/.temp/`, `verify-before-main.md`, patches, media work or other unrelated files.
- After each task: review its diff against its task text, run that task's check, commit with a sentence-case imperative subject and an agent trailer. Keep the feature flag off until Task 9.

## Review Focus

- A former member opens a copied link or an old recording: Task 3's token check and Task 7/8's RLS tests must refuse them, including after a mid-call removal. Already-issued playback URLs expire within 60 seconds.
- Two people press Start at once, or the starter never connects: Task 2's SQL test must produce one room and no false `meeting_started` notification.
- A stakeholder starts a project call: Task 1's SQL test must allow it without widening task/file/project writes.
- A phone joins a 100-person class call: Task 5's browser check must page a small number of tiles and avoid subscribing to 100 cameras.
- Recording upload fails or deletion retries: Task 8's SQL/integration checks must not expose a broken link or leave a falsely deleted file.

## File map

| File | Responsibility | Tasks |
| --- | --- | --- |
| `supabase/meetings.sql`, `supabase/project-stakeholders.sql` | Internal platform/nullable link and final stakeholder-aware meeting writers | 1 |
| `supabase/meeting-calls.sql` | Call state, access, notifications, chat, recordings, expiry and room metadata | 1, 2, 7, 8 |
| `supabase/tests/meetings.test.sql`, `supabase/tests/project-stakeholders.test.sql`, `supabase/tests/meeting-calls.test.sql` | Database regressions and new access rules | 1, 2, 7, 8 |
| `scripts/schema-drift.mjs`, `docs/07-backup.md` | Restore order and later-owner notes | 1, 8 |
| `supabase/functions/meeting-call/index.ts` | Authenticated token, start and host/provider actions | 3, 6, 8 |
| `supabase/functions/meeting-call-events/index.ts` | Verified LiveKit webhooks and reconciliation entry point | 3, 8 |
| `src/lib/meetings.ts`, `src/lib/api/meetings.ts`, `src/lib/meetingInvite.ts` and tests | New meeting type/status and APIs; old invite parser stays external-only | 4 |
| `src/components/meetings/ScheduleMeetingModal.tsx`, `MeetingRow.tsx`, `MeetingDetail.tsx`, `src/pages/app/meetings/Meetings.tsx` | Scheduler and list/detail behavior | 4 |
| `src/lib/paths.ts`, `src/App.tsx`, `src/pages/app/meetings/CallRoom.tsx` | Protected call route and screen | 5 |
| `src/components/meetings/CallPrejoin.tsx`, `CallStage.tsx`, `CallControls.tsx`, `CallSettings.tsx` | Device preview, adaptive video layout, controls, effects | 5, 6 |
| `src/components/meetings/CallPeople.tsx`, `CallChat.tsx`, `CallRecording.tsx` | Host/hand list, persistent chat, recording UI | 6, 7, 8 |
| `src/components/app/notificationDestination.ts`, `src/lib/types.ts` and tests | Live-call notification destination/type | 4 |
| `handoff.md` and deployment notes | Verified rollout and user/browser handoff | 9 |

---

### Task 1: Internal meeting platform and stakeholder access

**Files:**
- Modify: `supabase/meetings.sql`, `supabase/project-stakeholders.sql`
- Create: `supabase/meeting-calls.sql`, `supabase/tests/meeting-calls.test.sql`
- Modify: `supabase/tests/meetings.test.sql`, `supabase/tests/project-stakeholders.test.sql`
- Modify: `scripts/schema-drift.mjs`, `docs/07-backup.md`

**Interfaces:**
- Produces: `meeting_platform` gains `collabify`; `meetings.join_url` is nullable only when platform is `collabify`; `create_meeting(..., p_join_url text, ...)` accepts null for an internal meeting without changing its signature.
- Produces: `organization_settings.meeting_calls_enabled boolean not null default false`, readable by authenticated users, writable only through an admin/service-controlled release step.
- Preserves: the existing `create_meeting`, `update_meeting`, `cancel_meeting`, `meeting_audiences` signatures and all external URL checks.

- [ ] **Step 1: Write failing SQL assertions.** In the two existing suites and `meeting-calls.test.sql`, assert: the false flag refuses a null-URL meeting; after a service-only flag enable inside the rolled-back fixture, null URL creates `collabify`; an external link still derives Zoom/Meet; a non-null invalid URL is refused; changing an external link to null is refused; a project stakeholder can create/manage their own project meeting but still cannot write a project task; a student cannot create a class meeting or another group's meeting.
- [ ] **Step 2: Run the three suites.** `node scripts/db.mjs supabase/tests/meetings.test.sql` and the two named stakeholder/call suites. Expected: the new assertions fail for the missing platform/permission.
- [ ] **Step 3: Update the base schema and final owners.** Add `collabify` idempotently, conditional URL constraints and trigger derivation in `meetings.sql`; change the final `project-stakeholders.sql` definitions so stakeholder membership permits project/project-team meeting creation, editing and cancelling without calling `general_can_write`. Keep class/group/space rules. Add the disabled flag in `meeting-calls.sql` and require it for null-URL creation. Do not broaden `general_can_write`.
- [ ] **Step 4: Register the new SQL file.** Place it after the current `project-open-tasks.sql` tail and before the final `anon-lockdown.sql` in `docs/07-backup.md`; reconcile the stale suffix in `scripts/schema-drift.mjs` so its ORDER matches the restore line. Document that `meeting-calls.sql` is the final owner of any later meeting functions it redefines.
- [ ] **Step 5: Apply in restore order, then check.** Apply changed SQL through the documented later-owner suffix and `anon-lockdown.sql` last. Run the three named suites, `supabase/tests/anon-lockdown.test.sql` and `node scripts/schema-drift.mjs`. Expected: no FAIL/ERROR and no unexplained final-owner shrink.
- [ ] **Step 6: Review the SQL diff and commit named files.** Subject: `Add Collabify meeting platform`.

### Task 2: One call lifecycle and real start notifications

**Files:**
- Modify: `supabase/meeting-calls.sql`, `supabase/tests/meeting-calls.test.sql`
- Modify: `src/components/app/notificationDestination.ts`, `src/components/app/notificationDestination.test.ts`, `src/lib/types.ts`

**Interfaces:**
- Produces: `meeting_call_state` = `scheduled | starting | live | ended`; `meetings.call_state`, `room_name`, `starting_at`, `started_at`, `started_by`, `ended_at`, `locked_at` (null for external meetings).
- Produces: `meeting_call_access(p_meeting uuid)` returns one row with `room_name`, `call_state`, `can_start`, `can_host`, `can_join`, or no row for a nonmember. `begin_meeting_call(p_meeting uuid)` returns the same row after one atomic start claim. `confirm_meeting_live(p_meeting uuid, p_room text)` and `finish_meeting_call(p_meeting uuid, p_room text)` are service-only, idempotent transitions.
- Produces: `list_my_meetings_v2(p_since timestamptz, p_before timestamptz, p_limit int)` and `get_my_meeting_v2(p_meeting uuid)` return the existing meeting fields plus internal state. Keep `list_my_meetings` for old clients and Calendar.

- [ ] **Step 1: Write failing SQL tests.** Prove six-scope start rights, class/group restrictions, current active membership, one winner for duplicate starts, a `starting` room that sends no started notice, one notice on verified first connection, no restart after end/cancel/archive, lock and 100-person room metadata. A nonmember gets no access row. Test `get_my_meeting_v2` against an old meeting beyond 30 days.
- [ ] **Step 2: Run `meeting-calls.test.sql`.** Expected: failures for missing functions/columns.
- [ ] **Step 3: Implement lifecycle in `meeting-calls.sql`.** Generate an opaque room name once; a host token is allowed in `starting`, normal joins only in `live`. Derive co-hosts from the current audience leader checks, including `groups.leader_id`; the starter is host only while still in the audience. `confirm_meeting_live` uses a row lock and adds one `meeting_started` notice to the audience except starter. Enforce the eight-hour maximum and a bounded starting timeout; leave the empty-room grace period to Task 3's reconciler.
- [ ] **Step 4: Update the notification type and destination.** Add `meeting_started` to the app union and route it to the meeting call through `paths`; test that an unavailable meeting falls back to Meetings.
- [ ] **Step 5: Apply SQL, re-run `anon-lockdown.sql`, and verify.** Run `meeting-calls.test.sql`, `meetings.test.sql`, `anon-lockdown.test.sql`, the destination test and `npm run build`. Expected: all pass.
- [ ] **Step 6: Review the diff and commit named files.** Subject: `Track Collabify call lifecycle`.

### Task 3: Signed tokens, provider events and reconciliation

**Files:**
- Create: `supabase/functions/meeting-call/index.ts`, `supabase/functions/meeting-call-events/index.ts`
- Modify: `supabase/meeting-calls.sql`, `supabase/tests/meeting-calls.test.sql`
- Modify: `docs/07-backup.md`

**Interfaces:**
- Produces: authenticated `POST meeting-call` actions `join`, `start`, `end`, `lock`, `unlock`; request carries only `meeting_id` and action. `join/start` return `{serverUrl, token, meetingId, canHost}`; no room/API secret is accepted from the browser.
- Produces: signed `meeting-call-events` webhook for `room_started`, `participant_joined`, `participant_left`, `room_finished`, and a service-authorized scheduled reconciliation action. All event IDs are deduplicated.

- [ ] **Step 1: Add failing SQL tests for provider-facing transitions.** Service-only confirmation/end functions refuse authenticated callers; a starting timeout can reset before anyone connected; end/lock are idempotent; a removed or deactivated user cannot receive a fresh token decision; a stale live meeting is eligible for reconciliation.
- [ ] **Step 2: Run `meeting-calls.test.sql`.** Expected: new assertions fail.
- [ ] **Step 3: Implement the signed-in Edge Function.** Validate Supabase user JWT, call `meeting_call_access` with that user's claims, then mint a short-lived token with only `roomJoin` for the stored room and profile ID as identity. Start uses `begin_meeting_call`. End/lock/unlock recheck `can_host` and coordinate provider changes with the DB. Keep LiveKit credentials in Supabase secrets. Token issuance checks 100-person capacity and lock state.
- [ ] **Step 4: Implement provider webhooks and a reconciler.** Verify LiveKit signature before privileged reads; map only stored room names, deduplicate webhook ID and confirm live only after an actual media connection. End an empty room after a grace period, disconnect a removed member, reject a post-lock arrival with a previously minted token, and end at eight hours. Reconcile stale states and missed webhooks by querying LiveKit. Document the scheduled invocation and deployment settings.
- [ ] **Step 5: Apply SQL, re-run lockdown and verify.** Run `meeting-calls.test.sql`, `anon-lockdown.test.sql`, `npm run build`. With a test LiveKit project, verify a member token joins, a nonmember cannot get one, one first connection creates one notice, and a forced disconnect removes a revoked member. No production flag flip.
- [ ] **Step 6: Review and commit named files.** Subject: `Secure Collabify call access`.

### Task 4: Schedule and list Collabify meetings

**Files:**
- Modify: `src/lib/meetings.ts`, `src/lib/meetings.test.ts`, `src/lib/api/meetings.ts`
- Modify: `src/lib/meetingInvite.ts`, `src/lib/meetingInvite.test.ts`
- Modify: `src/components/meetings/ScheduleMeetingModal.tsx`, `MeetingRow.tsx`, `MeetingDetail.tsx`, `src/pages/app/meetings/Meetings.tsx`

**Interfaces:**
- Produces: `MeetingPlatform = 'collabify' | 'google_meet' | 'zoom'`; `ExternalMeetingPlatform = Exclude<MeetingPlatform, 'collabify'>`; `Meeting.call_state` and actual start/end fields.
- Produces: `meetingState(m, now)` from actual state for Collabify and the existing time calculation for external links; `canJoin(m, now)` routes internal calls only when live. `MeetingInput.joinUrl: string | null`.

- [ ] **Step 1: Write failing pure tests.** A scheduled internal meeting remains scheduled after its clock time; a starting room does not show Join; live/ended state follows actual timestamps; external 15-minute join behavior and invitation parsing remain unchanged. The parser's platform is `ExternalMeetingPlatform`.
- [ ] **Step 2: Run `npx vitest run src/lib/meetings.test.ts src/lib/meetingInvite.test.ts`.** Expected: the new cases fail.
- [ ] **Step 3: Update types and API.** `listMeetings` uses v2 for the Meetings page, with a paged older-history call and `get_my_meeting_v2` for direct links; Calendar keeps its existing call. When the server flag is on, the scheduler defaults to Collabify, hides the link field for it, and keeps invitation paste for external. With the flag off, only external choices appear. Block provider changes on edit.
- [ ] **Step 4: Update rows and details.** Copy link through `paths`, show scheduled/starting/live/ended honestly, show Start only to eligible audience members, and retain external Join behavior. A direct link to an old internal meeting loads its detail; a nonmember sees no title or chat.
- [ ] **Step 5: Verify.** Run the two named Vitest files and `npm run build`. Browser-check external creation/edit/join with the flag off and internal scheduling in a test environment with the flag on. Expected: old flow still works and the internal choice appears only when enabled.
- [ ] **Step 6: Review and commit named files.** Subject: `Schedule meetings inside Collabify`.

### Task 5: Prejoin and responsive video room

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/lib/paths.ts`, `src/lib/paths.test.ts`, `src/App.tsx`
- Create: `src/pages/app/meetings/CallRoom.tsx`, `src/components/meetings/CallPrejoin.tsx`, `CallStage.tsx`, `CallControls.tsx`, `CallSettings.tsx`
- Test: `src/components/meetings/CallControls.test.tsx` and browser layout checks

**Interfaces:**
- Consumes: Task 3 `meeting-call` `join/start` responses and Task 4 `Meeting` state.
- Produces: `paths.meetingCall(id: string): string` = `/meetings/:id/call`; a protected `CallRoom` route that loads the meeting through `get_my_meeting_v2`.
- Produces: `CallPrejoin` returns device/background choices without creating a live meeting; `CallStage` renders speaker or paged 4/9/16 grid. `CallSettings` changes devices/effect while connected.

- [ ] **Step 1: Add failing route/control tests.** `paths.test.ts` asserts the call URL. `CallControls.test.tsx` asserts mic/camera buttons and press-and-hold push to talk: release remutes, Space does nothing while typing in chat, and host-muted audio cannot be unmuted locally.
- [ ] **Step 2: Run the two test files.** Expected: missing route/components fail.
- [ ] **Step 3: Add the minimum LiveKit dependencies and route.** Pin compatible `livekit-client`, `@livekit/components-react` and `@livekit/track-processors` versions. The call route stays inside `ProtectedRoute` + `AppShell`; only the room page loads the media bundle. Use the existing design tokens, not SDK default raw colors.
- [ ] **Step 4: Build prejoin and stage.** Request device permission only after user action; support no camera/mic. Show camera, mic and available speaker selection. Offer off, blur, supplied photo and device-local photo. Screen share uses the browser tab/window/screen picker. Speaker view and paged grid render only visible tracks, with a 2–4 tile phone page. Settings changes devices and background mid-call; unsupported effects fall back to unprocessed video.
- [ ] **Step 5: Wire Start/Join/Leave and resilience.** Start calls the Task 3 endpoint only after prejoin; Join opens only for a live call; Leave disconnects just that person. Handle denied devices, lost connection, retry, a room ended by a host, and a room whose membership was revoked. Present a link-copy control that copies `paths.meetingCall(id)`, never the LiveKit URL.
- [ ] **Step 6: Verify.** Run the two tests and `npm run build`; in the test LiveKit project browser-check desktop, tablet, 375px phone, camera/mic denial, screen tab vs whole display, reconnect and a simulated 100-person room. Expected: no horizontal overflow and only the visible camera tracks subscribed on phone.
- [ ] **Step 7: Review and commit named files.** Subject: `Join Collabify video calls`.

### Task 6: Host controls and raised hands

**Files:**
- Modify: `supabase/functions/meeting-call/index.ts`, `supabase/meeting-calls.sql`, `supabase/tests/meeting-calls.test.sql`
- Modify: `src/components/meetings/CallControls.tsx`, `CallRoom.tsx`
- Create: `src/components/meetings/CallPeople.tsx`
- Test: `src/components/meetings/CallPeople.test.tsx`

**Interfaces:**
- Consumes: Task 2 `meeting_call_access.can_host` and Task 3 signed-in host action endpoint.
- Produces: `POST meeting-call` actions `mute`, `stop_share`, `remove`, `end`, `lock`, `unlock`, with `meeting_id` and a target profile ID only when needed. Raised hands are the caller's LiveKit participant state, cleared by self or host.

- [ ] **Step 1: Write failing SQL/component tests.** Test current class faculty, student group leader, project/space managers and coordinators, team leaders, and starter as hosts; a former leader and a mere scheduler are not hosts. A nonhost sees no moderation controls. A removed user or user holding a pre-lock token cannot stay in a locked room. A hand is visible to everyone and can be cleared.
- [ ] **Step 2: Run `meeting-calls.test.sql` and `CallPeople.test.tsx`.** Expected: new host/hand assertions fail.
- [ ] **Step 3: Implement checked provider actions.** The Edge Function rechecks `can_host` for each action, maps target identity to the current room, and uses provider APIs to mute a mic, stop a share, remove or end. A removal revokes the target token and records a run-only ban. Lock stops new token issuance; the webhook disconnects a late arrival using a token minted just before the lock. Permit hosts to rejoin their locked call.
- [ ] **Step 4: Add UI.** Put raised hands first in People, with clear-hand control for hosts; confirm removal and End for everyone. Show lock and recording state to all, but controls only to hosts. Do not offer remote unmute or remote camera-on.
- [ ] **Step 5: Verify.** Apply SQL and `anon-lockdown.sql`; run both named tests, `anon-lockdown.test.sql`, `npm run build`, then browser-check two members and a moderator in the test room. Expected: a nonhost cannot issue provider actions by calling the endpoint directly.
- [ ] **Step 6: Review and commit named files.** Subject: `Moderate Collabify calls`.

### Task 7: Persistent in-call chat

**Files:**
- Modify: `supabase/meeting-calls.sql`, `supabase/tests/meeting-calls.test.sql`
- Create: `src/components/meetings/CallChat.tsx`
- Modify: `src/pages/app/meetings/CallRoom.tsx`, `src/components/meetings/MeetingDetail.tsx`
- Modify: `src/lib/api/meetings.ts`

**Interfaces:**
- Produces: `meeting_call_messages(id uuid, meeting_id uuid, sender_id uuid, body text, created_at timestamptz)`; audience-only SELECT, live-call-only INSERT, body length 1–2,000 characters, no client UPDATE/DELETE.
- Produces: `listCallMessages(meetingId: string, before?: string, limit?: number)` and `sendCallMessage(meetingId: string, body: string)` in `src/lib/api/meetings.ts`.

- [ ] **Step 1: Add failing SQL assertions.** Current audience reads during and after; former/nonmembers cannot read; only an active call participant sends while live; after end or archive nobody sends; empty/overlong bodies fail; meeting deletion removes chat. Include a late-joined member reading earlier chat.
- [ ] **Step 2: Run `meeting-calls.test.sql`.** Expected: missing chat table/policies fail.
- [ ] **Step 3: Add the table, index, RLS and grants.** Use the established `meeting_can_see` rule plus current active status, and a live-call write check. Subscribe through Supabase Realtime; use the database as the one chat source of truth.
- [ ] **Step 4: Build chat panel and history.** Show sender/time, send and receive without duplicate rows, load older messages by cursor, and render read-only history in Meeting detail after the call. Escaping is text-only; no HTML, attachments or file uploads.
- [ ] **Step 5: Verify.** Apply SQL and `anon-lockdown.sql`; run `meeting-calls.test.sql`, `anon-lockdown.test.sql`, `npm run build`; browser-check two accounts exchanging messages, reload, end, history and access loss. Expected: messages persist and a former member cannot load them.
- [ ] **Step 6: Review and commit named files.** Subject: `Keep meeting chat history`.

### Task 8: Host-started recordings and 30-day expiry

**Files:**
- Modify: `supabase/meeting-calls.sql`, `supabase/tests/meeting-calls.test.sql`, `docs/07-backup.md`
- Modify: `supabase/functions/meeting-call/index.ts`, `supabase/functions/meeting-call-events/index.ts`
- Create: `src/components/meetings/CallRecording.tsx`
- Modify: `src/pages/app/meetings/CallRoom.tsx`, `src/components/meetings/MeetingDetail.tsx`, `src/lib/api/meetings.ts`

**Interfaces:**
- Produces: `meeting_call_recordings(id uuid, meeting_id uuid, egress_id text unique, storage_path text, status text, started_at timestamptz, ended_at timestamptz, expires_at timestamptz)`; statuses `starting | recording | processing | ready | failed | deleting`. Each stop/resume creates a separate segment; `expires_at = ended_at + interval '30 days'`.
- Produces: `POST meeting-call` `record_start`/`record_stop` host actions, verified Egress webhook updates and `listMeetingRecordings(meetingId: string)` for the current audience.

- [ ] **Step 1: Prove storage wiring in isolation.** With a test LiveKit project and private test bucket, make one short Egress recording to Supabase's S3 endpoint. Verify finalized MP4, private access and deletion through the Storage API. If incompatible, use private S3 with the same access/expiry contract and record the choice in this plan before other Task 8 work.
- [ ] **Step 2: Add failing SQL tests.** Only a host may initiate/stop; every current audience member reads ready metadata; nonmembers/former members do not; a processing/failed row never appears playable; segment expiry is exactly 30 days after completion; cleanup selects only expired ready/failed rows and retains retryable failures. The recording bucket is private.
- [ ] **Step 3: Run `meeting-calls.test.sql`.** Expected: new assertions fail.
- [ ] **Step 4: Implement metadata, Egress and deletion.** Host actions request Egress using server-side S3 credentials; verified webhooks update status idempotently. Use a private bucket, audience-checked playback URL issuance with a maximum 60-second lifetime, and a daily Storage-API deletion job that removes metadata only after bytes are gone. No recording starts before the host confirms. Keep a failed row as an error for hosts to see, never as a playable item.
- [ ] **Step 5: Build recording UI.** Show a persistent in-call recording indicator and notification to late joiners; offer Start/Stop only to hosts, with confirmation. Meeting detail shows processing/ready/failed segments and their expiry, with no recording after expiry. Renew the short playback URL through the audience check during playback so long recordings continue. Keep chat after recordings expire.
- [ ] **Step 6: Verify.** Apply SQL and `anon-lockdown.sql`; run `meeting-calls.test.sql`, `anon-lockdown.test.sql`, `npm run build`; browser-check recording start/stop/resume, two segments, playback by a member, refusal for a nonmember, Egress failure, and a clock-controlled expiry/deletion retry. Expected: no public object or broken playable link.
- [ ] **Step 7: Review and commit named files.** Subject: `Record Collabify meetings privately`.

### Task 9: End-to-end release and handoff

**Files:**
- Modify: `handoff.md`
- Modify: `docs/07-backup.md` only if final run exposes a restore-order correction
- Modify: `docs/superpowers/specs/2026-11-20-collabify-video-meetings-design.md` only for an owner-approved change

**Interfaces:**
- Consumes: Tasks 1–8. Produces: a verified, enabled Collabify call option without changing external meetings.

- [ ] **Step 1: Self-review the whole feature against the spec.** Check all six scopes, stakeholder permission, member-only links, 100-person behavior, start notification, eight-hour stop, responsive call UI, host controls, persistent chat, recording/expiry and external regression. Fix concrete gaps before release.
- [ ] **Step 2: Run the complete gates.** `npm run check`, every `supabase/tests/*.test.sql` suite, schema drift and `anon-lockdown.test.sql`. Expected: build, unit, lint, accessibility, contrast, SQL and schema checks pass.
- [ ] **Step 3: Validate provider operations with test accounts.** Test project, class and student-group flows, a stakeholder starting a project call, a forwarded link refused for a nonmember, a membership removal mid-call, phone layout, a simulated 100-person call, missed-webhook reconciliation, host recording and private playback. Observe provider usage/billing alert settings. Do not sign in, sign out or register on the owner's behalf.
- [ ] **Step 4: Prepare a release review.** Show the owner the working browser flow, exact recording notice/consent text and any cost estimate from measured test minutes. Obtain the school's recording policy decision before enabling recording in production.
- [ ] **Step 5: Deploy in order and enable.** Apply final SQL then `anon-lockdown.sql`, deploy Edge Functions, configure verified LiveKit webhook and Supabase secrets, verify the private recording bucket and scheduled reconciler/deletion job, deploy frontend, then enable `meeting_calls_enabled`. Smoke-test one member-only project call and one external meeting.
- [ ] **Step 6: Append handoff and commit.** Note provider version, restore order, secrets' names only, test evidence, operating cost and any deferred items in `handoff.md`; commit named files with subject `Launch Collabify video meetings` and push `main`.

## Next step

The owner reviews this plan. No implementation starts before approval. Execute each task in order, with its own diff review and commit; keep the server flag off until Task 9.
