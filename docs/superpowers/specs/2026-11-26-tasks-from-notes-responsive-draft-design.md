# Tasks from notes responsive draft layout

## Intent

Keep every draft field aligned and usable from phone widths through wide desktop screens. The task card should remain easy to scan without changing drafting or saving behavior.

## Design

- Keep the title and description full width.
- Put Starts and Due in a schedule group: one column on phones, two columns from the small breakpoint.
- Put Priority, Type and Estimated hours in a details group: one column on phones, two on tablets, three on wider screens.
- Keep optional sprint, assignee, team and milestone controls in the existing responsive grid below those groups.
- Preserve labels, accessible names, modal scrolling, validation and class-board behavior.

## Approaches

- Chosen: semantic schedule and details groups. Predictable wrapping and no empty desktop cell.
- Rejected: one dense six-column grid. More compact, but fragile when optional controls appear.
- Rejected: stack every field at all widths. Clear, but unnecessarily tall on laptops and desktops.

## Verification

Check the draft at phone, tablet and desktop widths; run the focused component tests, type check, lint and production build.
