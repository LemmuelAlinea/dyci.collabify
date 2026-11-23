# Space Workload tab redesign

Status: approved · 2026-11-24

## Intent

The space Workload tab is a plain list of people with four week cells of "used / available" hours. The owner wants a
better overview, filters (per project and more) and a search. Asana, ClickUp and Float all show people as rows and
weeks as columns, colored by load, with a toolbar to search, filter by project or role and sort.

## Decisions (owner)

- Layout: a summary strip, a toolbar, then the people × weeks grid ("Summary + heatmap grid").
- Hours are found with status chips (Over, Near full, Has room, Away) and Sort (most loaded, most free, name); the
  search box finds names.

## Design

- **Summary (the first week shown):** Team load (planned ÷ available over the people shown), Over (load above
  available), Near full (80% or more), Has room (under 80%), Away (an away day that week), Tasks without an estimate.
  Clicking a count turns on that status.
- **Toolbar:** search by name; Project (one or more), Team (the space's teams), Role (space role); status chips; Sort;
  Clear filters. Filters live in the page link (`?q=&project=&team=&role=&status=&sort=`).
- **Project filter (my call):** cells show only the chosen projects' hours, with a faint "+N h elsewhere"; tone and
  status use the person's total load, so someone overloaded elsewhere never looks free.
- **Grid:** as today (4 weeks, arrows), each row also shows the space role. The open row lists this week's tasks
  grouped by project with each project's hours; Mark away and accuracy stay.
- **No matches:** "No one matches these filters." with Clear filters.
- **Phone:** the summary wraps, the filters sit in one Filters popover, the grid shows the first week.
- No database change: per-project load, space roles, space teams and away ranges are already read.

## Left to the builder

Exact styling, the popover's layout, labels for counts.
