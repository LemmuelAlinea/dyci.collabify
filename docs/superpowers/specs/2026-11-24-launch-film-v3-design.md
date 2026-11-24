# Launch film v3 — design

Approved by the owner on 2026-11-24.

## Intent

A new landing-page film that replaces the 80 s October film (`public/video/collabify-film.mp4`).
Since October the work spaces gained most of Collabify's important features, and the old film
does not show them. The film opens on the problem Collabify solves (project work scattered across
apps), welcomes the viewer, shows that the app is theirs to color, then walks the work-space
features first and the educational side second.

## Goals

- Under 2:30 total, never over. Target 2:22.
- Order: hook → Welcome to Collabify → Make it yours → work spaces → educational side → close.
- Every feature shown is real and live; screens are rebuilt from the real design tokens.
- Reads with the sound off (captions track carries the voice-over).

## Non-goals

- No portrait version (the landing player is 16:9).
- No admin features (offices, notices, organization settings).
- No paid Higgsfield credits, plans, trials or top-ups.

## Anti-goals

- Tiny screenshots or popup-only scenes (why the Codex cut was rejected).
- Any feature shown doing something the app does not do.
- Hardcoded colors outside the token set; status shown in brand amber.

## Constraints

- Higgsfield account: free plan, 10 credits, no unlimited allowance. Grok Imagine Video 1.5 Lite
  at 720p costs 1 credit per second; `gpt_image_2_6` costs 0.75 per image. Budget: one still
  (0.75) + one 9 s image-to-video clip (9) = 9.75. No re-roll is possible, so the still is shown
  to the owner before it is animated.
- HyperFrames needs Node 22+: `export PATH="/c/Program Files/nodejs:$PATH"` (Node 24).
- Write big JS files with the Write tool; Bash heredocs truncate them.
- Never fade `.cam` (flattens 3D); fade `.fade`.

## Approaches

1. **Higgsfield cold open + HyperFrames product film (picked).** The only live footage is the
   hook, where AI video earns its place; the product is rebuilt as UI so it is sharp at 1080p.
2. All-Higgsfield film — impossible on 10 credits (about 10 s of footage).
3. Screen recordings of the live app — needs signed-in demo data, and small recorded UI is what
   the October review rejected.

## Run of show (2:22, 1920×1080, 60 fps)

| Time | Beat | On screen | Voice-over idea |
|---|---|---|---|
| 0:00–0:10 | Hook | Higgsfield clip: a student/young professional at night, laptop full of tabs and pings. Type: "Chats in one app. Files in another. Deadlines in your head." → "What if your whole project lived in one place?" | the two lines |
| 0:10–0:17 | Welcome | Logo build, definition | "Welcome to Collabify — one place where classes and teams plan, build and finish together." |
| 0:17–0:27 | Make it yours | Appearance settings: palette, banner, status colors, light/dark | your colors on banners, statuses, sidebar, progress |
| 0:27–0:36 | Work spaces | Space home (Overview, Projects, Reports, Settings), project cards, space look | a work space holds every project of a team |
| 0:36–0:47 | Roles, teams, positions, skills | Members: PM, Coordinator, Member, QA, Stakeholder; teams with leads; positions; skill tags | everyone has a role, a team and their skills |
| 0:47–0:58 | Tasks from a file or a discussion | Tasks from notes: upload file → pick a saved discussion → drafted tasks to keep | turn a file or a meeting into tasks |
| 0:58–1:10 | Workload balancing AI | Break down and balance: big task split, holders by skill and room, load bars | AI splits big work fairly, by skill and hours |
| 1:10–1:20 | Sprint suggestion AI | Sprints → Suggest sprints: "Suggested: 3 sprints of 2 weeks" | AI suggests the sprints |
| 1:20–1:32 | Project settings | Settings: stages, Tasks (priority, subtasks, dependencies, task types), Workflow rules "When… then…" | shape the project your way |
| 1:32–1:42 | Built-in meetings | Collabify video call, prejoin → call | meet without leaving |
| 1:42–1:49 | Classes | Class banner with class look, syllabus term map, Waiting on you | — |
| 1:49–1:56 | Class projects | Brief, From a file with fit check (unticked task with reason) | — |
| 1:56–2:03 | Groups | Group page, Hand-in & grade, rubric score card | — |
| 2:03–2:08 | Peer evaluation | Rate your team | — |
| 2:08–2:14 | Analytics & reports | Needs attention strip, report exported to Excel/Word | — |
| 2:14–2:22 | Close | Logo, dyci-collabify.vercel.app | sign-off |

Beat lengths are tied to the final voice-over line durations; the ends above are targets, the 2:30
ceiling is fixed.

## Build decisions

- New HyperFrames project `cinema-v3/` (sibling of `cinema/`), same architecture: one
  `index.html`, one paused GSAP timeline, scenes as `js/sNN.js` builders, UI kit copied from
  `cinema/css/ui.css`, `cinema/js/kit.js`, `cinema/js/screens.js` and extended with the new
  screens. The October project stays untouched.
- Hook clip: still via `generate_image`, owner approves, then `generate_video` with
  `grok_video_v15_lite`, 9 s, 720p, 16:9, start_image = the still; downloaded into
  `cinema-v3/assets/hook.mp4` and graded/scaled in the composition with the type over it.
- Voice-over: Kokoro `af_heart` via `npx hyperframes tts`, one wav per line in `audio/vo/`.
- Music and SFX synthesised locally (Python), mixed to `audio/mix.wav`.
- Captions: `captions.srt` → `public/video/collabify-film.en.vtt`.
- Landing: replace `public/video/collabify-film.mp4` and the poster; update `CHAPTERS`, the header
  comment and the "Eighty seconds" copy in `src/components/landing/Workflow.tsx`. Copy rules apply
  (sentence case, no exclamation marks).
- Verify with `npx hyperframes snapshot --at …` contact sheets, then a full render; `npm run build`
  after the landing change. Commit locally; the owner reviews before anything is pushed to main.

## Left to the builder

- Exact voice-over wording per beat (within the ideas above and the copy rules).
- Demo data on screens (believable project, team and class names; no real people).
- Music character and transitions between beats.
