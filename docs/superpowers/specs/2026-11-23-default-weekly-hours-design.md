# Default weekly hours

Status: approved · 2026-11-23 · simplifies `2026-11-22-space-workload-balancing-design.md`

## Intent

Workload, time off, away days, room warnings and sprint hours all do nothing until someone types weekly hours for
each person, because hours start as "Not set". The owner recorded a day off and saw no effect for that reason. Other
tools start everyone on a default (ClickUp: a workspace schedule, 40 h a week; Jira Plans: a default team capacity),
so workload works on day one. Collabify should too.

## Decisions (owner)

- Only this change (not one-click Break down, not bulk estimates).
- Each work space has a default, **40 h a week** to start. A person's hours are their own value if set, else the
  space default. "Not set" no longer exists.

## Approaches

- **A default per space that the hours read falls back to (chosen).** One place decides a person's hours, so load,
  leave, room, forecast and sprint hours follow without changes, and a later change to the default reaches everyone
  who has no own value, including new members.
- Copy 40 h into every membership row: rejected; new members get nothing and a changed default reaches nobody.
- A school-wide value in Organization settings, or a fixed 40 h: offered, not chosen.

## Design

- `general_space_hours_default` (space, weekly minutes 0–10080, who, when); no row means 2400 (40 h). Written only by
  `set_space_default_weekly_minutes`, by the space's project manager or coordinators (my call: they already set anyone's
  hours), work spaces only, not archived. Read by space members through `space_default_weekly_minutes`.
- `work_person_hours` falls back to the default when the person has no own value. `general_space_people_hours` also
  returns `own_weekly_minutes` (null when on the default) so the Members page can show the field empty.
- A person's own value still overrides; clearing it puts them back on the default. 0 still means no hours here.
- App: Space Settings → Members gets "Default weekly hours" above the list (planners edit, others read). A member on
  the default shows an empty field with placeholder "40 (default)", or "40 h (default)" read-only. My load reads
  "40 h a week · space default" instead of "Not set" with a Set field. "Not set" copy for weekly hours goes away.
- Live effect: everyone without hours gets 40 h at once; existing values stay.

## Non-goals

- Per-day schedules, part-time patterns, holidays. Unestimated tasks still count as unknown work.

## Left to the builder

- Copy wording, exact layout of the default field, and removing UI branches that only served "Not set".
