# Admin bulk registration

Approved 2026-10-26. The admin imports at most 100 CSV rows from Accounts.
Required columns: `first_name,last_name,email,role`; optional: `middle_name`.
Roles are `student` or `member`, with both member switches off. One password
is entered per batch. Only exact `@dyci.edu.ph` addresses are accepted.
Existing and invalid rows are skipped and reported. The admin distributes
credentials; imported email addresses are confirmed without sending mail.

## Tasks

1. Add a strict CSV parser, shared row validation, and an Accounts modal with a
   template, preview, errors, password field, confirmation, progress and results.
   Send valid rows in groups of 20. Never store or export the password.
2. Add an authenticated Edge Function that checks an active admin and repeats
   validation before calling Auth Admin `createUser`. Return one result per row.
3. Have `handle_new_user` create imported profiles pending with setup required.
   Add a first-sign-in screen that records both consent choices, changes the
   password through a second authenticated Edge Function, and activates the
   profile only after both actions succeed. Gate other app routes meanwhile.
4. Add tests for parsing, validation, authorization, pending setup and ordinary
   sign-up. Run Vitest, build and SQL suites. Apply SQL, run `anon-lockdown.sql`
   last, deploy both functions, then deploy the frontend. The owner checks one
   live import and first sign-in using a disposable DYCI address.
