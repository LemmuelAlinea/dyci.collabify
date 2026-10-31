# 3 · Turn on "Continue with Microsoft"

Two dashboards are involved: Microsoft Entra (Azure) to register the app, and Supabase to
hold its keys. Budget about 15 minutes. Collabify signs in with Microsoft only; Google
sign-in was removed on 2026-11-01.

## 3.1 Get your Supabase callback URL first

1. Supabase dashboard → **Authentication** → **Sign In / Providers** → **Azure**.
2. Copy the **Callback URL (for OAuth)**. It looks like:
   `https://abcdefghijkl.supabase.co/auth/v1/callback`

Keep this tab open.

## 3.2 Register the app in Microsoft Entra

1. Go to <https://portal.azure.com> and sign in with the Microsoft account that will own
   the app (a personal account works; a free Azure account is enough).
2. Search **App registrations** → **New registration**.
3. **Name**: `Collabify`
4. **Supported account types**: **Accounts in any organizational directory and personal
   Microsoft accounts**. This lets school (Microsoft 365) accounts and personal
   Outlook/Hotmail accounts both sign in.
5. **Redirect URI**: platform **Web**, paste the Supabase callback URL from 3.1.
6. **Register**.
7. On the app's **Overview**, copy the **Application (client) ID**.

## 3.3 Create a client secret

1. **Certificates & secrets** → **Client secrets** → **New client secret**.
2. Description `Supabase`, expiry 24 months → **Add**.
3. Copy the **Value** now (not the Secret ID). It is shown once.

The secret expires. Put the expiry date in your calendar: when it lapses, Microsoft
sign-in stops until a new secret is pasted into Supabase.

## 3.4 Ask for a verified email

Supabase links a Microsoft sign-in to an existing account with the same email only when
Microsoft marks the email as verified.

1. **Token configuration** → **Add optional claim** → token type **ID**.
2. Tick `email` and `xms_edov` → **Add** (accept the Microsoft Graph permission prompt).
3. **API permissions**: check `email`, `openid` and `profile` (Microsoft Graph,
   delegated) are listed.

## 3.5 Paste them into Supabase

1. Supabase → **Authentication** → **Sign In / Providers** → **Azure**.
2. Toggle **Enable Sign in with Azure** on.
3. **Application (client) ID**: from 3.2. **Secret value**: from 3.3.
4. Leave **Azure Tenant URL** empty to allow any Microsoft account. To allow only one
   school's accounts, set it to `https://login.microsoftonline.com/<tenant-id>`.
5. **Save**.
6. Turn the **Google** provider off on the same page.

## Verify

1. `npm run dev`
2. Go to <http://localhost:5173/login> and click **Continue with Microsoft**.
3. First time through, you land on **Finish your profile**. After that, Microsoft sign-in
   goes straight to your dashboard.

Microsoft gives Collabify a name and an email, but never a role or a picture. That is why
the profile step exists.

## Accounts that used Google

Accounts made with Google sign-in keep their data. To get back in, the person either:

- signs in with a Microsoft account on the same email address, or
- uses **Forgot password** on the sign-in page to set a password for that email.

Their Google profile picture keeps loading from `lh3.googleusercontent.com` until they
upload their own, which is why that host stays in the CSP in `vercel.json`.

## Common errors

| Error | Meaning | Fix |
|---|---|---|
| `Unsupported provider: provider is not enabled` | Azure is off in Supabase | Do 3.5 |
| `AADSTS50011` redirect URI mismatch | The Entra redirect URI is not Supabase's callback | Paste the exact `https://….supabase.co/auth/v1/callback` into **Authentication → Redirect URIs** |
| `AADSTS50020` account not in tenant | The app or the Tenant URL allows only one organization | Pick the multi-tenant + personal option in 3.2, and clear the Tenant URL |
| `Error getting user email from external provider` | No email claim | Do 3.4 |
| `AADSTS7000215` invalid client secret | Secret expired or the Secret ID was pasted | Make a new secret and paste its **Value** |
| Returns to the site still signed out | App URL missing from Supabase redirect allowlist | Add `http://localhost:5173/**` under **Authentication → URL Configuration** |

Next: [04-deploy-vercel.md](04-deploy-vercel.md)
