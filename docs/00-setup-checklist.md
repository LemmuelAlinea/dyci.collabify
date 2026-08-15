# Collabify setup — do these in order

Everything here is a one-time task. Work top to bottom; each guide assumes the ones
above it are done.

| # | Task | Guide | Who |
|---|------|-------|-----|
| 1 | Create the Supabase project and run the schema | [01-supabase-setup.md](01-supabase-setup.md) | You + Claude |
| 2 | Point Supabase's emails at Brevo | [02-brevo-email.md](02-brevo-email.md) | You |
| 3 | Turn on "Continue with Google" | [03-google-oauth.md](03-google-oauth.md) | You |
| 4 | Push to GitHub and deploy on Vercel | [04-deploy-vercel.md](04-deploy-vercel.md) | You + Claude |
| 5 | Make yourself the superadmin | [05-superadmin.md](05-superadmin.md) | Claude |

## Run it locally right now

The landing page works with no setup at all. Auth stays disabled until step 1.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173.

## What "phase 1" ships

- Landing page — responsive, animated, light and dark
- Register (student / professor) with email confirmation
- Sign in with email or Google
- Forgot password → emailed reset link → set a new password
- Professor accounts held for superadmin approval
- Role-based app shell for student, professor, and superadmin
- Settings: profile + avatar, appearance, notifications, password reset, sign out

Boards, milestones, files, and the approval console arrive in phase 2.
