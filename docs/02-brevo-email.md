# 2 · Send Collabify's emails through Brevo

Supabase's built-in mailer is capped at a few messages per hour and is meant for
testing only. Brevo's free tier sends 300/day. You point Supabase at Brevo's SMTP
server once, and every confirmation and reset email goes through it — no server code.

## 2.1 Create the Brevo account

1. Go to <https://www.brevo.com> → **Sign up free**.
2. Use the email you want listed as the sender.
3. Confirm your address from the email Brevo sends.
4. Brevo asks a few onboarding questions. Pick **I want to send transactional emails**
   when offered.

New accounts are usually reviewed within a few hours before sending unlocks. If SMTP
credentials are greyed out, that review is why — check back later.

## 2.2 Verify your sender address

1. Left sidebar → **Senders, Domains & Dedicated IPs** → **Senders** tab.
2. Click **Add a sender**.
   - **From name**: `Collabify`
   - **From email**: the address students will see, e.g. `noreply@yourdomain.com` or
     your Gmail address to start with.
3. Brevo emails that address a confirmation link. Open it.
4. The sender shows a green **Verified** state when it is ready.

**If you own a domain** (recommended once you go live): switch to the **Domains** tab,
click **Add a domain**, and add the DKIM/SPF DNS records Brevo shows you at your
registrar. A verified domain keeps Collabify's mail out of spam. A plain Gmail sender
works for testing but often lands in Promotions or Spam.

## 2.3 Get the SMTP key

1. Click your account name (top right) → **SMTP & API**.
2. Open the **SMTP** tab.
3. Note these three values:
   - **SMTP server**: `smtp-relay.brevo.com`
   - **Port**: `587`
   - **Login**: shown on the page — an address like `9a1b2c001@smtp-brevo.com`
4. Click **Generate a new SMTP key**, name it `collabify`, and copy the key. It is shown
   once.

## 2.4 Point Supabase at Brevo

1. Supabase dashboard → **Project Settings** → **Authentication** → scroll to **SMTP
   Settings**. (On some dashboard versions: **Authentication** → **Emails** → **SMTP
   Settings**.)
2. Turn **Enable Custom SMTP** on.
3. Fill in:

   | Field | Value |
   |---|---|
   | Sender email | the address you verified in 2.2 |
   | Sender name | `Collabify` |
   | Host | `smtp-relay.brevo.com` |
   | Port | `587` |
   | Username | the Brevo SMTP login from 2.3 (the `@smtp-brevo.com` one) |
   | Password | the SMTP key you generated |
   | Minimum interval between emails | `10` seconds |

4. Click **Save**.

The username is the `@smtp-brevo.com` login, **not** your Brevo account email. Using
the account email is the single most common reason this fails.

## Verify

1. Go to <http://localhost:5173/forgot-password>.
2. Enter an address that has a Collabify account and submit.
3. The email should arrive within about a minute, from your verified sender.
4. In Brevo, **Transactional** → **Logs** shows every send with its delivery status —
   check there first when something does not arrive.

## When it does not arrive

| Symptom | Cause | Fix |
|---|---|---|
| Supabase says "Error sending recovery email" | Wrong SMTP username | Use the `@smtp-brevo.com` login, not your account email |
| Nothing in Brevo logs at all | Custom SMTP not saved | Re-check the toggle in Supabase and save again |
| Brevo log says "blocked" | Sender not verified | Finish 2.2 |
| Lands in spam | Unverified domain | Add the domain and its DKIM/SPF records in 2.2 |

Next: [03-google-oauth.md](03-google-oauth.md)
