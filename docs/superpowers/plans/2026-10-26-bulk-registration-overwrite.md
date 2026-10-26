# Bulk registration: existing accounts

Approved by the owner on 2026-10-26. A repeated email must appear in the CSV preview with the current account's name and role. Each repeat has an opt-in overwrite choice. Without it, that row is skipped. Overwrite changes the profile's name and student/member role in place. The account ID, password, status, and setup requirement remain intact. Existing role-change safeguards apply, including clearing both switches when a member becomes a student.

1. Refresh Accounts when a CSV is chosen, match emails without case sensitivity, and show each existing person before confirmation. Count creates, updates, and skips separately.
2. Send the overwrite choice per row. The authenticated Edge Function repeats validation and calls one admin-only database function that applies the role change and names in one transaction.
3. Test repeated CSV rows, repeated registered accounts, admin-only overwrite, in-place updates, and preserved password/setup state. Run build, Vitest, SQL suites, then deploy SQL, anon lockdown, Edge Function, and frontend.
