# Parent tasks follow their subtasks' dates

Status: approved · 2026-11-24

## Intent

Break down and balance gave "Make the level 0 and 1 DFD" (due 26 Nov 2:58 AM) five subtasks due 26 Nov 11:59 PM. The
owner's call: the subtasks are the work, so the parent adapts to them, not the other way round. Microsoft Project's
summary tasks and ClickUp's "Sync dates with subtasks" do the same; Jira and Asana users keep asking for it.

## Decisions (owner)

"Always follow, show moves": the parent follows automatically, every move is in its history, and a parent pushed past
its first due date says so. Rejected: following silently; a per-task switch.

## Design

1. A work task with live subtasks (not archived or trashed; done ones count) starts at the earliest subtask start
   and is due at the latest subtask due. A subtask with no date leaves that end as it was; if a start would land after
   the due, the start becomes the due. Recomputed when a subtask is added, deleted, archived, trashed, restored,
   moved to another parent or re-dated (`supabase/subtask-dates.sql`, a row trigger on `general_tasks`).
2. The parent is written with claims cleared under `collabify.subtask_dates` (like the other sanctioned writers), so
   whoever may re-date a subtask is never refused on the parent. While a task has live subtasks a person cannot set
   its dates: "This task's dates follow its subtasks. Change a subtask's dates instead."
3. `general_tasks.planned_due_at`: the parent's due date before its subtasks first moved it, written only by this file.
   The task window shows "Due Fri 28 Nov, after its planned Wed 26 Nov 2:58 AM" in amber when the due date is later.
4. History: the existing `updated` row for the parent's move gets the subtask changer as actor and `by: 'subtasks'`
   (a BEFORE INSERT trigger on `general_task_events`, so `record_general_task_event` is not redefined); it reads
   "moved the due date to … following its subtasks".
5. Break down and balance: a subtask due on the parent's due date gets the parent's due time instead of 11:59 PM
   (`apply_work_breakdown` in `work-workload.sql`).
6. On first apply every existing parent is brought in line quietly: old due dates become planned dates, no history
   rows, no notices. Re-runs change nothing.
7. Work projects only; class boards keep their behavior.

## Left to the builder

Exact copy, where "Follows its subtasks" sits in the task window, trigger names.
