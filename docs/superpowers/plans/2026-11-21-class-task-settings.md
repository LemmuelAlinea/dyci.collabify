# Class task settings and task details

**Goal:** Let professors configure task workflow steps, rules, and types for each class project. Give class tasks subtasks, priority, editable due dates in the detail window, and dependencies.

1. Add idempotent per-project SQL settings, task columns, relationship checks, and typed professor RPCs. Cover the rules in a rolled-back SQL suite.
2. Add a Tasks section to class Settings with a project selector and the three requested panels.
3. Add type and priority to class task creation and editing, and due date, subtask, and dependency controls to the task detail window.
4. Register the migration in restore and drift order, update docs, verify SQL, tests, lint, typecheck, and build, then push `main`.
