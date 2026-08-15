# Collabify

A project workspace for BSIT capstone teams and the professors advising them.

Phase 1 — the landing page, authentication, and per-user settings — is what lives here
today. Boards, milestones, files, and the approval console come next.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite · React 19 · TypeScript · React Router 7 |
| Styling | Tailwind v4 with semantic surface tokens (light + dark) |
| Motion | Motion (framer-motion) + IntersectionObserver reveals |
| Auth, database, storage | Supabase |
| Transactional email | Brevo, wired as Supabase's SMTP provider |
| Hosting | Vercel |

No custom backend in phase 1 — Supabase covers auth, data, and avatar storage.

## Run it

```bash
npm install
```

```bash
npm run dev
```

The landing page works with no configuration. Auth needs Supabase keys — see
[docs/00-setup-checklist.md](docs/00-setup-checklist.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:5173 |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run typecheck` | Types only |
| `node scripts/db.mjs supabase/schema.sql` | Apply the database schema |
| `node scripts/set-role.mjs <email> <role> [status]` | Promote a user or approve a professor |

## Roles

| Role | How you get it | Home |
|---|---|---|
| Student | Chosen at register, active immediately | `/student` |
| Professor | Chosen at register, held until a superadmin approves | `/professor` |
| Superadmin | Set from the command line only | `/admin` |

A database trigger strips any self-service attempt to change `role` or `status`, so a
student cannot promote themselves even with a crafted request.

## Layout

```
src/
  components/   brand · ui · landing · app shell · motion
  context/      AuthContext · ThemeContext
  lib/          supabase client · types · role routing
  pages/        Landing · Settings · auth/* · app/*
  routes/       ProtectedRoute
supabase/       schema.sql · email-templates/
scripts/        db.mjs · set-role.mjs
docs/           numbered setup guides
```

## Environment

`.env.local`, gitignored:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_DB_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Only the two `VITE_` variables belong in Vercel. The other two are admin secrets and
stay local.
