# 5 · Make yourself the superadmin

Nobody can register as a superadmin — the register form only offers student and
professor, and a database trigger blocks anyone from promoting themselves. The first
superadmin is set from the command line.

## Steps

1. Register normally at `/register` as a **student**, using the email you want as your
   admin account, and confirm it.
2. Then run:

```bash
node scripts/set-role.mjs you@example.com superadmin
```

3. Sign out and sign back in. You land on `/admin`.

`SUPABASE_DB_URL` must be in `.env.local` for this to work — see
[01-supabase-setup.md](01-supabase-setup.md).

## Approving a professor

Professors sign up like anyone else, but land on a waiting screen until you approve
them. Until the approval console ships in phase 2:

```bash
node scripts/set-role.mjs prof@example.com professor active
```

To reject instead:

```bash
node scripts/set-role.mjs prof@example.com professor rejected
```

## Seeing who is waiting

```bash
node scripts/db.mjs -c "select email, role, status, created_at from public.profiles where status = 'pending' order by created_at"
```

## Undoing a mistake

```bash
node scripts/set-role.mjs someone@example.com student active
```
