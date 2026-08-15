# Collabify — working notes

Project management for BSIT programs in the Philippines. Roles: student, professor,
superadmin. Phase 1 (shipped): landing, auth, settings. Phase 2: boards, milestones,
files, approval console.

## Commands

```bash
npm run dev          # http://localhost:5173
npm run build        # tsc -b && vite build
npm run typecheck
node scripts/db.mjs supabase/schema.sql
node scripts/set-role.mjs <email> <role> [status]
```

Run `npm run build` before claiming anything works — `tsc -b` runs first and catches
most breakage.

## Design system

Do not hardcode colors. Everything reads from tokens in `src/styles/index.css`:

- Surfaces: `surface`, `surface-raised`, `surface-sunken`
- Text: `text-ink`, `text-muted`, `text-faint`
- Lines: `border-line`, `border-line-strong`
- Brand ramps: `navy-*` (600 is the brand), `amber-*` (400 is the accent)

Both light and dark are defined in the same block — a raw hex breaks one of them.

- Display face `font-display` (Outfit), body `font-sans` (Instrument Sans), utility
  `font-mono` (JetBrains Mono) for eyebrows and numerals.
- `.eyebrow` for the small mono uppercase labels, `.shell` for page gutters,
  `.blueprint` for the grid motif.
- Dark mode is the `.dark` class on `<html>`, set pre-paint by the inline script in
  `index.html`. Never switch on a media query alone.
- Motion goes through `components/motion/Reveal.tsx` or Motion's `useReducedMotion`.
  Reduced motion must stay honored.

## Conventions

- Desktop layout first, then tablet, then phone. Not a widened mobile column.
- Auth state comes from `useAuth()`; theme from `useTheme()`. No direct `supabase.auth`
  calls in pages except the one recovery-session check in `ResetPassword`.
- New protected pages go inside `<ProtectedRoute>` + `<AppShell>` in `App.tsx`, and get
  a nav entry in `components/app/nav.ts`. Phase-2 items sit in that file with
  `soon: true`.
- `supabase/schema.sql` must stay idempotent — it gets re-run.
- Copy style: sentence case, active voice, no exclamation marks, no "please", no
  "successfully". Errors say what happened and what to do next.

## Security invariants

- `role` and `status` are only changeable by a superadmin — enforced by the
  `profiles_guard_privileged` trigger, not just by UI.
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` never appear in frontend code, in
  Vercel, or in any committed file.
- Avatar uploads are scoped to `avatars/<user-id>/…` by storage policy.
