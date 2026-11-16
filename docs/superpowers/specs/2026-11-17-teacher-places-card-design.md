# Joined Classes & spaces card for teaching members with work

Date: 2026-11-17. Size: small change. Status: approved.

## Intent

A member with Can teach who is also in a work space (or on a work project) sees two
separate place cards in the rail today: Classes at the top and a Work card holding
spaces below Main. The two read as a mixed-up sidebar. They should be one card,
the same **Classes & spaces** card a student with work already has.

## Goals

- Teaching member with work (`membership.hasWork`: in a live work space, or on a
  work project) gets one **Classes & spaces** card at the top of the rail, with the
  Classes · Spaces switch.
- Their Work group keeps Projects and My tasks as plain rows under a **Work**
  heading below Main, with no card.

## Non-goals

- No change for a member who only teaches, a member with spaces only, students,
  admins or stakeholder-only members.
- No change to `PlacePicker`'s look or switch behavior.

## Who gets what

| Member | Rail |
|---|---|
| Can teach and `hasWork` | Classes & spaces card, Main, Work (Projects, My tasks), Resources, Account |
| Can teach only | Unchanged: Classes card, Main, Resources, Account |
| Can teach + Project manager, no work yet | Unchanged: Classes card, Main, Work card with spaces (empty, leads to New space), Resources, Account |
| No teaching | Unchanged |

The third row is the builder's call: the request names space membership, and the
empty Work card is where a project manager starts their first space.

## Approaches

1. **Reuse `placesGroup(['classes','spaces'])` in `railFor` (picked).** The joined
   card, its switch, its remembered tab and its collapsed icon rows already exist
   for students. Only the rail's group list changes.
2. Merge the cards inside `SideNav` at render time. Rejected: puts rail rules in the
   renderer instead of `nav.ts`, where every other rail decision lives.
3. A new teacher-only card component. Rejected: duplicates `PlacePicker`.

## Design

- `railFor` in `src/components/app/nav.ts`: when `canTeach` and `membership?.hasWork`,
  the first group is `placesGroup(['classes', 'spaces'])` instead of
  `TEACHING_CLASSES`, and the Work group is a plain group (title Work, items
  Projects and My tasks, no picker).
- The switch opens on Classes (first list) unless the page in view is a space or
  the person last picked Spaces on this device, as `PlacePicker` already does.
- `hideWhenEmpty` stays off for the joined card: a teacher always has the Classes
  list, empty or not.
- Collapsed rail: two icon rows, Classes and Spaces, as for students.
- Update the doc comments on `navFor` / `teachingWork`.

## Tests

`SideNav.teaching.test.tsx` and the nav tests cover the four rows of the table.

## Left to the builder

Naming of the plain Work group helper; exact test layout.
