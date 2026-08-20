# 4 · Push to GitHub, deploy on Vercel

## 4.1 Create the GitHub repository

1. Go to <https://github.com/new>.
2. **Repository name**: `collabify`
3. **Visibility**: Private is fine — Vercel can still read it.
4. Leave **Add a README**, **.gitignore**, and **license** all unchecked. The folder
   already has files; an initialised repo makes the first push conflict.
5. Click **Create repository**.
6. Copy the URL from the page, e.g. `https://github.com/yourname/collabify.git`.

Give that URL to Claude and it handles the remote, the commit, and the push.

Doing it yourself:

```bash
git remote add origin https://github.com/yourname/collabify.git
```

```bash
git push -u origin main
```

`.env.local` is gitignored, so no keys go up.

## 4.2 Import into Vercel

1. Go to <https://vercel.com> and sign in **with GitHub**.
2. **Add New…** → **Project**.
3. Find `collabify` in the list → **Import**. If it is not listed, click **Adjust GitHub
   App Permissions** and grant access to the repo.
4. Vercel detects Vite on its own. Leave Framework Preset, Build Command
   (`npm run build`), and Output Directory (`dist`) as detected.

## 4.3 Add the environment variables

Before clicking Deploy, expand **Environment Variables** and add these two:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | your `https://….supabase.co` URL |
| `VITE_SUPABASE_ANON_KEY` | your anon / publishable key |

Only these two. The service role key and the database URL must never be added to a
Vercel project that serves a frontend — anything in a `VITE_` build is public, and the
others are secrets.

Click **Deploy** and wait about a minute. Vercel gives you a URL like
`https://collabify-xyz.vercel.app`.

## 4.4 Tell Supabase and Google about the new domain

Sign-in will fail on the live site until you do this.

**Supabase** → **Authentication** → **URL Configuration**

- **Site URL**: `https://collabify-xyz.vercel.app`
- **Redirect URLs**: add `https://collabify-xyz.vercel.app/**` (keep the localhost entry
  so local development still works)

**Google Cloud** → **APIs & Services** → **Credentials** → your `Collabify Web` client

- **Authorised JavaScript origins**: add `https://collabify-xyz.vercel.app`
- The redirect URI stays the Supabase callback — do not change it.

## 4.5 From here on

Every push to `main` redeploys automatically. Pull requests get their own preview URL.

## Verify on the live site

Run through all of these on the Vercel URL, not localhost:

- [ ] Landing page loads, animations run, theme toggle works
- [ ] Register a student → confirmation email arrives → link signs you in
- [ ] Sign out, then sign in again with the same password
- [ ] Continue with Google → profile step → dashboard
- [ ] Forgot password → email arrives → new password works
- [ ] Settings: change your name, reload, the change is still there
- [ ] Settings: switch to Dark, reload, still dark
- [ ] Settings: flip a notification toggle, reload, it stayed flipped
- [ ] Settings: sign out, then try to open `/settings` — you get bounced to sign-in

Next: [05-admin.md](05-admin.md)
