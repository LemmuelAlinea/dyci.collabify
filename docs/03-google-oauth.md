# 3 · Turn on "Continue with Google"

Two dashboards are involved: Google Cloud (to create the credentials) and Supabase (to
hold them). Budget about 15 minutes.

## 3.1 Get your Supabase callback URL first

You will need this in Google Cloud, so grab it now.

1. Supabase dashboard → **Authentication** → **Sign In / Providers** → **Google**.
2. Copy the **Callback URL (for OAuth)** shown there. It looks like:
   `https://abcdefghijkl.supabase.co/auth/v1/callback`

Keep this tab open.

## 3.2 Create a Google Cloud project

1. Go to <https://console.cloud.google.com>.
2. Click the project dropdown in the top bar → **New Project**.
3. **Project name**: `Collabify` → **Create**.
4. Wait for the notification, then make sure `Collabify` is the selected project in the
   top bar.

## 3.3 Configure the consent screen

1. Left menu → **APIs & Services** → **OAuth consent screen**.
2. If you see a **Get started** button, click it. Otherwise choose **External** →
   **Create**.
3. **App Information**
   - **App name**: `Collabify`
   - **User support email**: your email
4. **Audience**: **External**
5. **Contact Information**: your email
6. Agree to the policy and click **Create**.

Then add scopes:

1. **APIs & Services** → **OAuth consent screen** → **Data Access** (or **Scopes**).
2. Click **Add or remove scopes** and tick:
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `openid`
3. **Update** → **Save**.

While the app is in **Testing** mode only accounts you list can sign in:

1. **OAuth consent screen** → **Audience** → **Test users** → **Add users**.
2. Add your own Gmail and any accounts you will test with.

When you are ready for real students, come back and click **Publish app**. A basic app
that only requests email and profile does not need Google's verification review.

## 3.4 Create the OAuth client

1. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**.
2. **Application type**: **Web application**
3. **Name**: `Collabify Web`
4. Under **Authorised JavaScript origins**, click **Add URI** for each:
   - `http://localhost:5173`
   - `https://YOUR-APP.vercel.app` (add after step 4 of the setup)
5. Under **Authorised redirect URIs**, click **Add URI** and paste **the Supabase
   callback URL from 3.1** — the `https://….supabase.co/auth/v1/callback` one.

   This is the redirect URI. Not your app's URL. Getting this wrong produces
   `redirect_uri_mismatch` at sign-in.

6. Click **Create**.
7. A dialog shows **Client ID** and **Client secret**. Copy both.

## 3.5 Paste them into Supabase

1. Back in Supabase → **Authentication** → **Sign In / Providers** → **Google**.
2. Toggle **Enable Sign in with Google** on.
3. Paste the **Client ID** and **Client Secret**.
4. Click **Save**.

## Verify

1. `npm run dev`
2. Go to <http://localhost:5173/login> and click **Continue with Google**.
3. Pick a test-user account.
4. First time through, you land on **Finish your profile** — pick student or professor
   and enter your name. After that, Google sign-in goes straight to your dashboard.

Google gives Collabify a name and an email, but never a role. That is why the profile
step exists.

## Common errors

| Error | Meaning | Fix |
|---|---|---|
| `redirect_uri_mismatch` | The redirect URI in Google does not match Supabase's callback | Paste the exact `https://….supabase.co/auth/v1/callback` from 3.1 into **Authorised redirect URIs** |
| `access_blocked` / "not verified" | Your account is not a test user | Add it under **Audience → Test users**, or publish the app |
| Returns to the site still signed out | App URL missing from Supabase redirect allowlist | Add `http://localhost:5173/**` under **Authentication → URL Configuration** |

Next: [04-deploy-vercel.md](04-deploy-vercel.md)
