# Collabify redesign prompts

A complete brief for redesigning the signed-in surface of Collabify as a
**parallel mock** at `/redesign/*`, leaving the live product untouched.

The landing page and the admin console are out of scope.

---

## Read in this order

| | File | What it covers |
|---|---|---|
| **1** | [`00-BRIEF.md`](00-BRIEF.md) | **The rules.** Isolation, the anti-copy instruction, responsiveness, states, voice, accessibility. Re-read before every screen. |
| **2** | [`01-FOUNDATIONS.md`](01-FOUNDATIONS.md) | The design system to invent. What to inherit from the landing page and what not to. Build the specimen page first. |
| **3** | [`02-app-shell.md`](02-app-shell.md) | Navigation and the page frame. |

Then the screens. They assume 1–3 are done.

### Both roles

| File | Screen |
|---|---|
| [`05-classes-directory.md`](05-classes-directory.md) | Classes list |
| [`06-class-detail.md`](06-class-detail.md) | One class, six tabs |
| [`07-groups-directory.md`](07-groups-directory.md) | Groups, sets, archive and delete |
| [`08-group-detail.md`](08-group-detail.md) | One group |
| [`09-projects-directory.md`](09-projects-directory.md) | Projects list and the wizard |
| [`10-project-detail.md`](10-project-detail.md) | One project, brief tab |
| [`11-task-workspace.md`](11-task-workspace.md) | The tasks tab — **the core of the product** |
| [`12-task-detail.md`](12-task-detail.md) | One task |
| [`14-calendar.md`](14-calendar.md) | Calendar |
| [`15-messages.md`](15-messages.md) | Messages and polls |
| [`17-reports.md`](17-reports.md) | Reports, including the printed sheet |
| [`21-settings.md`](21-settings.md) | Settings |
| [`22-privacy.md`](22-privacy.md) | Your data, and the handler's queue |

### Student only

| File | Screen |
|---|---|
| [`03-student-dashboard.md`](03-student-dashboard.md) | Dashboard |
| [`13-my-tasks.md`](13-my-tasks.md) | My tasks |

### Professor only

| File | Screen |
|---|---|
| [`04-professor-dashboard.md`](04-professor-dashboard.md) | Dashboard |
| [`16-analytics.md`](16-analytics.md) | Analytics |
| [`18-course-documents.md`](18-course-documents.md) | Syllabi and curriculum |
| [`19-syllabus-detail.md`](19-syllabus-detail.md) | The week editor |
| [`20-reassignments.md`](20-reassignments.md) | The reassignment queue |

---

## Build order

1. Foundations, and the specimen page at `/redesign/foundations`.
2. The shell.
3. Both dashboards — they exercise the most components at once and will expose
   gaps in the system early.
4. The three directories — classes, groups, projects. They share a shape;
   design it once **in the system** and reuse it, or you will end up with three
   near-identical inconsistent screens.
5. The detail screens, then the task workspace, then the rest.

After every screen: 360, 768, 1280, 1920, in both themes, with the empty and
the overloaded fixture.

---

## The six things most likely to go wrong

1. **Restyling instead of redesigning.** Every file has a *Do not carry over*
   list. The most repeated item is the navy hero block with a split headline
   and a row of stat tiles — it opens nearly every screen in the current app
   and none of them should keep it.
2. **Touching shared files.** `src/styles/index.css`, `src/components/**` and
   `src/lib/**` are off limits. Copy into `src/redesign/` instead.
3. **Unscoped CSS.** Everything under `.rd`. A bare `:root` or element selector
   leaks into the live product.
4. **Designing the phone first.** This is used on laptops in labs. Design the
   desktop, then fold down.
5. **Short fake names.** "Ricardo Batumbakaldimagibababy" is a real user. If
   the layout only survives "Jane Doe", it does not survive.
6. **Making numbers look like grades.** The product holds **no grades at all**.
   Shares, points and progress are not marks, and any design that implies
   otherwise is factually wrong about what the product does.

---

## Vocabulary — use these words, invent none

class · group · group set · project · board · task · work log · syllabus week ·
hand in · return · accept · claim · release · archive

---

## Facts that constrain the design

- **A board is worth 100.** Tasks are slices of it; adding one shrinks the
  others.
- **There are no grades anywhere in the product.**
- **An announcement is visible to students for 24 hours**, then comes off.
- **A started task cannot change hands** without a professor's decision.
- **A reassignment reason is private** to the professor and its author.
- **Poll votes are not anonymous.**
- **A project cannot exist without a syllabus** to bind its weeks to.
- **Term dates gate everything measurable** in a class.
- **Deleting a group takes its board and its whole conversation** — archive is
  the default, and delete is refused when work exists.
- **Classes, projects and groups are archived, never deleted.**
- **File links expire after ten minutes**; profile photos are public and do not
  expire.
