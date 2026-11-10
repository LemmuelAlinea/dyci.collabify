# First-run walkthroughs

## Why

A new account opens Collabify and has no idea where to start. Each role already has a
message on its empty page ("Create space", "Create a class", "Join a class"), but nothing
connects the steps. After a project manager creates a space, the app opens the space and
does not point them to making a project.

The walkthrough takes a new person by the hand through the real app, shaped to what their
account can do, so they finish having done the first real thing rather than having read
about it.

Success looks like this: a new project manager ends the walkthrough with a real space and a
real first project, made by them.

## Goals

- A guided walkthrough for four account types: project manager, member who can teach,
  student, and plain member.
- Spotlight form: the app dims, the real button is lit, a small card explains the step, and
  the walkthrough waits until the person has actually done it.
- Project managers and teachers get theirs when the admin turns their switch on, not at
  sign-up, because nobody signs up as either. Registration only offers Student or Member.
- Progress follows the person across devices.

## Non-goals

- A tour of every feature. Each walkthrough covers the first real step only.
- Walkthroughs for stakeholders, QA or admins. An admin who has the Project manager switch
  still gets none.
- Inviting people or adding a first task as project manager steps. The last screen points
  to inviting people, nothing more.
- Any change to registration, the role choice or how the admin turns switches on.
- Videos, emails, or completion analytics.

## Anti-goals

The feature has failed, even if it technically works, if any of these happen:

- Someone is stuck behind it. There is always a way out.
- It creates anything for them, or shows demo data. Everything made is real and made by them.
- People already using Collabify when it ships are interrupted by it.
- It comes back after someone skipped it.
- A step points at a button that person cannot use, or that is not on the screen.

## Who gets what

The account step appears once per person, ever. A member who did it at first sign-in skips
it when they later become a project manager.

| Walkthrough | Starts | Steps | Ends on |
|---|---|---|---|
| Project manager (`canManageProjects`, role `member`) | The next time they open Collabify after the switch turns on | Account, create a space, start the first project in it | Their real project, with a pointer to Settings → Members for inviting people |
| Teaching (`canTeach`) | The next time they open Collabify after the switch turns on | Account, create a class, share the class code | Their real class, with the code on screen |
| Student | First sign-in | Account, join a class, find your work | Their class, or Home while waiting for a code |
| Plain member (no switches, not stakeholder-only) | First sign-in | Account, watch your Inbox | Home, knowing why it is empty |

Both switches on: teaching first, then project manager, with the account step once. When
teaching finishes, the project manager walkthrough follows right away. When teaching is
skipped, it waits for the next time they open Collabify, so pressing Skip never brings up
another spotlight at once.

A plain member who already has work or a class when they first sign in (`WaitingHome` is not
on screen) gets the account step only. If they accept an invitation during the Inbox step,
that step counts as done. A member whose only project roles are QA counts as a plain member;
the non-goal means there is no QA-specific walkthrough.

A plain member whose switch turns on partway drops the member walkthrough and starts the new
one. A switch turned off partway stops that walkthrough.

The walkthrough only runs inside `AppShell` for an active, admitted account, so sign-up,
`/onboarding`, `/setup-account` and `/pending` are untouched.

### The steps

Copy below is a draft. It can be tuned within the repo's copy rules: sentence case, active
voice, no exclamation marks, no "please", no "successfully".

| Step | Where | Lit target | Done when | Card text |
|---|---|---|---|---|
| Account | `/settings` | Photo control, then the Appearance section | The person presses Next. A photo is not required | "Set up your account. Add a photo and pick your look." |
| Create a space | `/spaces` | Create space button | They are PM of a live work space | "Create a space. A space holds your projects." |
| Start first project | `/spaces/:id/projects`, for the newest live work space they are PM of. Worked out from data, so it needs no saved space id | New project button | Any live work space they are PM of has a live project | "Start your first project. Name it and pick a starting shape." |
| Create a class | `/classes` | Create class button | They own a live class | "Create a class. Name it and set its section and term." |
| Share the code | The new class | The class code | The person presses Done | "Share this code with your section. Students join with it, so you never add them by hand." |
| Join a class | `/home` | Join a class button | They are in a class | "Join your class. Enter the code from your professor." |
| Find your work | The class, or `/home` | My tasks and Groups in the rail | The person presses Done | "Find your work. My tasks and Groups fill up from your class." |
| Watch your Inbox | `/home` | Open your Inbox button on `WaitingHome` | The person presses Done | "Invitations land in your Inbox. Work opens once you accept one." |

## How it behaves

- **Only the lit button works.** The rest of the page is dimmed and inert during a step.
  Skip is always available on the card.
- **Real dialogs.** Pressing the lit button opens the existing dialog (`NewSpaceDialog`,
  `NewProjectDialog`, the class form, `JoinClassDialog`). While a dialog is open the spotlight
  steps aside. If they cancel, the spotlight comes back.
- **Moves itself.** The walkthrough navigates to the page a step needs. Those dialogs already
  navigate on success, and the next step picks up from where that lands.
- **Done means the real thing exists.** Steps that create something finish by reading real
  data, not by a click, and a step already satisfied is passed over silently. A student who
  joined through a `/join/:code` link never sees the join step.
- **Leaving.** Closing the tab resumes at the same step next time, on any device.
- **Skip** ends that walkthrough for good.
- **No class code yet.** The student's join step has "I don't have a code yet". That pauses
  the walkthrough with no overlay, and it continues at Find your work once they join a class.
- **Replay.** Settings has a Replay walkthrough button that runs what the account qualifies
  for now. A replay is a look-only tour. No step is passed over, every step has Next, and the
  lit button does not open its dialog, so nobody makes a second space by accident. When a
  step's target is not on screen (a student already in a class has no Join button, a teacher
  with no class has no code), the step shows the same text on a centered card with no
  spotlight.
- **People here at launch.** Accounts that are active and have signed in at least once
  (`auth.users.last_sign_in_at` is set) are marked as finished with what they qualify for on
  the day this ships, account step included. Accounts that have never signed in, including
  bulk-created and pending ones, get their walkthrough as normal. An existing plain member who
  is later given a switch does get that walkthrough, because they have not seen it.

## Constraints

- Follow `CLAUDE.md`: design tokens only, light and dark, the person's own palette still
  applies, `useAuth()` for auth, Motion through `Reveal` or `useReducedMotion` with reduced
  motion honored.
- Desktop first, then tablet and phone. On a phone the rail is a drawer, so rail targets
  cannot be lit directly.
- Saved progress lives in the database, not `localStorage`, because it has to follow the
  person across devices. It must be readable and writable only by that person.
- `profiles` is guarded by `profiles_guard_privileged`, so progress does not go on it.
- SQL is idempotent, in its own file, run before `anon-lockdown.sql`, and listed in
  `docs/07-backup.md`. `anon-lockdown.sql` is re-run after any new function.
- `Modal` renders through a portal at `z-[60]`, so the spotlight has to sit correctly against
  it.
- `npm run build` passes before anything is called working. Every step is walked in the
  browser as each account type. Nothing is pushed to `main` until the owner has reviewed it,
  since `main` is the live site.

## Calls made by the designer

These were not asked of the owner and can be overturned:

- Saved progress is a small table of its own, one row per person per walkthrough.
- No new dependency. The overlay is hand-built, because it has to wait on real data and use
  the person's palette and reduced motion.
- Real buttons get a stable marker (for example a `data-walkthrough` attribute) rather than
  being found by their text.
- An admin with the Project manager switch gets no walkthrough.
- A photo is optional on the account step.
- A plain member who already has work gets the account step only.
- After a skipped teaching walkthrough, the project manager one waits for the next open.
- A replay is look-only, with a centered card when a step's target is not on screen.
- The launch backfill covers active accounts that have signed in at least once.
- With no space made during the walkthrough, Start first project uses their newest PM space.

## Left to the builder

- Table shape and the logic module's layout. The rules for which walkthrough applies should
  be plain functions with Vitest tests, like `lib/access.ts`.
- How rail targets show on a phone, whether by opening the drawer or by a centered card that
  names the rows. The Find your work step is the only one affected.
- Spotlight animation, card placement, keyboard handling and focus. The card must be reachable
  by keyboard and announced to screen readers.
- Where the class code sits on the class page, and how to light it.
