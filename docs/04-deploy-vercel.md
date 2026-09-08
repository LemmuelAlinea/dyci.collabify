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

## Response headers

`vercel.json` sets these on every response. JSON takes no comments, so the
reasoning lives here.

| Header | Why |
| --- | --- |
| `Strict-Transport-Security` | A year, `includeSubDomains`, and deliberately **no `preload`** — preloading is hard to undo and would bind every subdomain of the college's domain, including services that are not ours. |
| `X-Content-Type-Options: nosniff` | Stops a browser guessing a type we did not send. |
| `X-Frame-Options: DENY` | With `frame-ancestors 'none'` in the CSP. Two headers because older browsers read only the first. |
| `Referrer-Policy` | `strict-origin-when-cross-origin`. Vercel logs referrers, so this limits what is in them. |
| `Permissions-Policy` | Denies camera, microphone, geolocation, payment and USB. None are used. |
| `Cross-Origin-Opener-Policy: same-origin` | Safe **because Google sign-in is a full-page redirect**, not a popup. If `signInWithOAuth` is ever switched to `skipBrowserRedirect` with a popup, this header breaks the handshake. |

`Cross-Origin-Embedder-Policy` is **not** set. It would require CORP on every
cross-origin resource, which breaks the landing page's 3D model for no gain here.

### The Content-Security-Policy

It ships as **`Content-Security-Policy-Report-Only`**. In that mode the browser
reports violations to the console and blocks nothing, which is the only safe way
to find out what a real CSP would break. Flip the header name to
`Content-Security-Policy` as its own deploy, once the walk below is clean, so it
can be reverted on its own.

Directive by directive:

- **`script-src 'self'`** — no `'unsafe-inline'` and no `'unsafe-eval'`. The two
  scripts that used to sit inline in `index.html` are now `/theme.js` and
  `/browser-check.js`. Nothing in the app evals: the 3D board loads a plain GLB
  with no DRACO or KTX2 decoder, there are no workers and no wasm, and three.js
  compiles shaders through WebGL rather than JavaScript.
- **`style-src` keeps `'unsafe-inline'`**, and this is the policy's real
  weakness. Motion injects `<style>` elements at runtime, and a statically
  hosted SPA cannot mint a per-request nonce without middleware. A style
  injection vector stays open. Worth knowing rather than assuming the policy is
  complete.
- **`connect-src` must list `wss://<ref>.supabase.co`.** CSP governs WebSockets,
  and without it Supabase realtime dies **silently** — the symptom is that other
  people's changes stop appearing, which is very hard to trace back to a header.
- **`img-src`** allows the Supabase host (storage, including signed URLs) and
  `lh3.googleusercontent.com`, which is needed only because Google profile
  photos are stored as their original URL.
- The Supabase project ref is **hardcoded** here while `VITE_SUPABASE_URL`
  carries it at build time. It is not a secret — it is already in the client
  bundle — but the two must match. If the project changes, change both.

### Walk before flipping it

With report-only deployed, open the console and check it stays quiet through:
the landing page with the 3D board running a full loop; sign in; open a class
and load a file; send a message and watch it arrive in a second window
(realtime, over `wss:`); read a syllabus with AI and generate tasks (both edge
functions); change a profile photo.

Next: [05-admin.md](05-admin.md)
