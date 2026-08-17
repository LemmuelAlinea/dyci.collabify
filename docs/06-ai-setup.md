# 6 · Reading syllabi with AI

The week map works entirely by hand — this step only removes the typing. Skip it
and everything still functions; the "Read with AI" button just reports that the
key is missing.

## What it does

Upload a syllabus, press **Read with AI**, and the file's weekly schedule comes
back as a draft you check and correct. Nothing downstream ever reads the file
again — projects, deadlines, and the week map all read the rows you verified.

## 6.1 Get an Anthropic API key

1. Go to <https://console.anthropic.com> and sign up.
2. **Settings** → **API keys** → **Create key**. Name it `collabify`.
3. Copy it — it starts with `sk-ant-` and is shown once.
4. Add credit under **Billing**. $5 is plenty; see the cost note below.

## 6.2 Install the Supabase CLI

```bash
npm install -g supabase
```

```bash
supabase login
```

That opens a browser to authorise the CLI.

## 6.3 Link the project

From the Collabify folder:

```bash
supabase link --project-ref jublbxdqzcjmbunukxct
```

It asks for your database password — the one from
[01-supabase-setup.md](01-supabase-setup.md) §1.1.

## 6.4 Set the key as a secret

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here
```

The key lives on Supabase's servers. It is never sent to the browser, never in
the repository, and never in `.env.local`.

## 6.5 Deploy the function

```bash
supabase functions deploy parse-syllabus
```

## Verify

1. Go to **Syllabi**, upload a real syllabus (PDF or Word).
2. Open it with the calendar icon.
3. Press **Read with AI**.
4. Weeks appear as a draft in a few seconds. Check every one, fix what is wrong,
   then press **Mark verified**.

## Cost

A syllabus is a few thousand tokens. Reading one costs well under a peso, and it
only runs when you press the button — not on every page load. Re-reading
replaces the draft, so avoid re-parsing a syllabus you have already corrected.

## When it fails

The editor always works, so a failure never blocks you.

| Message | Cause |
|---|---|
| "The AI key is not set on the server yet" | §6.4 was skipped, or the deploy in §6.5 came before it |
| "Only PDF and Word (.docx) files can be read automatically" | Old `.doc`, or a spreadsheet — retype the weeks, or re-save as PDF |
| "No readable text was found — the file may be a scan" | The PDF is images of pages, not text. Nothing can read it; add the weeks by hand |
| "No weekly schedule was found in this file" | The file was read but has no week-by-week table |

## What it does not do

It does not judge or grade a syllabus, and it does not fill in weeks the
document leaves out — it only reports what is written. A wrong week in the draft
is a reading error, so read the draft before marking it verified.

---

# 6.7 Drafting tasks

A second function, `generate-tasks`, breaks a project into tasks. It uses the
same key and the same deploy step:

```bash
supabase functions deploy generate-tasks
```

**Where it lives.** Open a project, go to the **Tasks** tab, then **Draft with
AI** (professor) or **Draft tasks with AI** (student, on their group board).

**What it reads.** The project's guidelines, its rubric, and the topics,
outcomes, and assessments of the syllabus weeks it is bound to. Nothing else —
it has no access to other classes, and it never sees a file it was not given.

**What it writes.** Nothing. It returns a draft. You tick what to keep, edit the
wording and the weights, and only then are the tasks saved. A professor's picks
go out to one group or all of them; a student's land on their own board.

**Cost.** One draft is a few thousand tokens — well under a peso — and only runs
on the button.

| Message | Cause |
|---|---|
| "The AI key is not set on the server yet" | §6.4 was skipped, or this deploy came before it |
| "That project is not available to you" | You are not in the class, or the project has not been released |
| "Nothing could be drafted from this brief" | Too little to go on. Write guidelines or a rubric first, or add the tasks by hand |

**What it does not do.** It does not grade, does not assign anybody, and does not
decide what the project is. A draft with a task you did not want is a draft — the
board is only ever what you saved.
