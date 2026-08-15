# 1 · Supabase project setup

Supabase handles sign-in, the database, and avatar storage. No other backend is needed
in phase 1.

## 1.1 Create the project

1. Go to <https://supabase.com/dashboard> and sign in with GitHub.
2. Click **New project**.
3. Fill in:
   - **Name**: `collabify`
   - **Database Password**: click **Generate a password**, then **copy it somewhere safe
     right now** — you cannot read it again later.
   - **Region**: `Southeast Asia (Singapore)` — closest to the Philippines.
4. Click **Create new project** and wait ~2 minutes for it to finish provisioning.

## 1.2 Copy the four values Collabify needs

Still in the dashboard, with your project open:

**Value 1 and 2 — Project URL and anon key**

1. Left sidebar → **Project Settings** (gear icon at the bottom).
2. Click **API Keys** (or **API**).
3. Copy **Project URL** — looks like `https://abcdefghijkl.supabase.co`.
4. Copy the **anon** / **publishable** key — a long string starting with `eyJ` or `sb_`.

**Value 3 — service role key**

1. Same page, under **Secret keys** / **service_role**.
2. Click the reveal icon and copy it.
3. This key bypasses every security rule. Never paste it into frontend code, a
   screenshot, or a chat message.

**Value 4 — database connection string**

1. Left sidebar → **Project Settings** → **Database**.
2. Find **Connection string** → choose the **Session pooler** tab (port `5432`).
3. Copy the URI. It looks like:
   `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
4. Replace `[YOUR-PASSWORD]` with the database password from step 1.1.

## 1.3 Put them in `.env.local`

In the project folder, create a file named `.env.local` (it is gitignored — it never
reaches GitHub):

```
VITE_SUPABASE_URL=https://abcdefghijkl.supabase.co
VITE_SUPABASE_ANON_KEY=paste_the_anon_key_here
SUPABASE_DB_URL=postgresql://postgres.abcdefghijkl:yourpassword@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
SUPABASE_SERVICE_ROLE_KEY=paste_the_service_role_key_here
```

Then tell Claude "the Supabase keys are in .env.local" — Claude runs the schema for you.

## 1.4 Create the tables

Claude runs this, or you can:

```bash
node scripts/db.mjs supabase/schema.sql
```

This creates `profiles` and `notification_prefs`, the signup trigger, all row-level
security policies, and the public `avatars` storage bucket. It is safe to re-run.

If you would rather paste it by hand: Supabase dashboard → **SQL Editor** → **New
query** → paste the contents of `supabase/schema.sql` → **Run**.

## 1.5 Auth settings

Left sidebar → **Authentication**.

**Sign In / Providers → Email**

- **Enable Email provider**: on
- **Confirm email**: **on** — this is what sends the confirmation link.
- **Secure email change**: on

**URL Configuration**

- **Site URL**: `http://localhost:5173` for now. Change it to your Vercel URL after
  step 4.
- **Redirect URLs** — click **Add URL** for each of these:
  - `http://localhost:5173/**`
  - `https://YOUR-APP.vercel.app/**` (add after Vercel gives you the domain)

Without these, the confirmation and reset links bounce to an error page.

## 1.6 Email templates

**Authentication → Emails → Templates**

- Open **Confirm signup**, set the subject to `Confirm your Collabify account`, and
  replace the message body with the contents of
  `supabase/email-templates/confirm-signup.html`.
- Open **Reset password**, set the subject to `Reset your Collabify password`, and
  replace the body with `supabase/email-templates/reset-password.html`.

Keep `{{ .ConfirmationURL }}` exactly as written — Supabase substitutes the real link.

## Verify

1. `npm run dev`
2. Go to <http://localhost:5173/register> and create a student account with a real
   address.
3. You should land on the "Confirm your email" page and get an email within a minute.

Only 3–4 emails per hour work at this stage — that is Supabase's built-in sender limit.
Step 2 (Brevo) removes it.

Next: [02-brevo-email.md](02-brevo-email.md)
