# 04 — Professor dashboard

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Route: `/redesign/professor`
Who: a professor, on every sign-in.

---

## What it is for

A different question from the student's. Not *what do I owe* but **what needs
me, and is anything going quietly wrong.**

The distinction matters for the design. A student's dashboard is a list of
obligations. A professor's is a monitor: most of what it shows is fine, and the
job of the page is to make the exceptions impossible to miss without turning
the ordinary state into an alarm.

---

## Order, and why

The main column runs in this order and it is deliberate:

1. **Needs your attention** — first, because every item in it is something
   only a professor can clear.
2. **Groups that have stalled** — second: a person's problem rather than a
   setting's, and it gets worse quietly.
3. **Progress across the classes** — last, because it is a reading rather than
   a task.

---

## Contents

### The state sentence

- Anything waiting or stalled →
  `"2 things are waiting on you."` + `"1 group has stopped moving."`
- Neither, but a class is incomplete →
  `"Every group is moving, but 1 class is not set up yet."`
- All well, projects running →
  `"3 projects are open and every group is moving."`
- Nothing at all → `"Nothing is waiting on you. Set a project when you are ready."`

"Not set up yet" means a class missing its syllabus, its term start, or its
term end. **Nothing in it can be measured until those exist**, which is why it
is called out rather than left to be discovered.

Urgent when something is waiting or stalled.

### Four figures

| Figure | Value | Goes to |
|---|---|---|
| Waiting on you | things needing a decision — **warns above zero** | *(no link; the list is below)* |
| Groups not moving | stalled boards — **warns above zero** | Projects |
| Projects open | live, excluding archived and scheduled | Projects |
| Students | total across every class | Classes |

### Needs your attention

The queue of things only this professor can clear. Each item names what it is,
which class and project it belongs to, how long it has been waiting, and links
to the place the decision is actually made. Kinds include: a group that has
handed work in and is waiting on a verdict, a reassignment request, a class
that is not set up, a project with nothing on its board.

### Your classes

A rail of the professor's classes: initial, name, section, student count, and
its state — running, needs setup, archived. Links into the class.

### Groups that have stalled

Boards where nothing has moved for a while. Each shows the group, its project
and class, how long since anything happened, and how far it got. Links to the
board. This is the page's most valuable section and should be designed as
though it is: it is how a professor finds the group that has quietly fallen
apart before the deadline does it for them.

### Progress across your classes

A comparison across every live project and its boards: how many groups started,
how far the average board has got, how many have handed in. This needs **width**
— squeezed into a column the bars become noise. It is the one section that
should span the full content width on a large screen.

### Program notices

Notices from the program office, as on the student dashboard.

---

## Responsive

- **360px** — one column in the order above. The progress comparison becomes a
  list of rows rather than a chart, or scrolls inside itself. It must not
  become a smear of 4px bars.
- **768px** — attention and classes may pair; progress stays full width.
- **1280px** — attention and stalled groups lead, classes beside them,
  progress full width beneath.
- **1920px+** — more room for the progress comparison, not more whitespace
  around the same content.

---

## States

- **Loading** — skeletons in the layout's shape.
- **Empty (no classes)** — one explanation: create a class, share its code
  with the section, and groups, projects and everything on this page follow
  from it. One action.
- **Empty (classes but nothing wrong)** — the good state, and it should look
  calm and finished, not like a page that failed to load. This is the state a
  professor sees most often and it is the one most designs neglect.
- **Error** — inline with retry; the rest still renders.

---

## Keep

- The three-part order and its reasoning.
- The four figures, and "waiting on you" having no destination because its list
  is on the page.
- Calling out classes that are not fully set up.
- Progress needing the full width.

## Do not carry over

- The navy hero block and the tile row inside it.
- The bento grid with one `wide` cell as the only way to give the progress
  table room.
- Giving "needs your attention" the same visual weight as "your classes".
