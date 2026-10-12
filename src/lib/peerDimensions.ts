/**
 * The five CATME behaviours, in our own words. A rating is 1–5. Points 2 and 4
 * sit between the anchors shown for 1, 3 and 5.
 */
export const PEER_DIMENSIONS = [
  {
    key: 'contributes',
    label: "Contributes to the team's work",
    low: 'Does not do a fair share; poor quality',
    mid: 'Does a fair share of acceptable quality',
    high: 'Does more than a fair share; high quality',
  },
  {
    key: 'interacts',
    label: 'Interacts with teammates',
    low: 'Interrupts, ignores or bosses others',
    mid: 'Listens, shares and respects others',
    high: "Asks for and shows interest in others' ideas; makes sure everyone is heard",
  },
  {
    key: 'on_track',
    label: 'Keeps the team on track',
    low: 'Unaware of progress; lets problems slide',
    mid: 'Notices and helps fix problems',
    high: 'Watches progress, gives feedback and helps the team plan',
  },
  {
    key: 'quality',
    label: 'Expects quality',
    low: 'Satisfied with weak work',
    mid: 'Encourages the team to do good work',
    high: 'Motivates the team to excellent work',
  },
  {
    key: 'skills',
    label: 'Has the knowledge and skills the work needs',
    low: 'Missing basic skills the work needs',
    mid: 'Has enough skill to contribute',
    high: 'Has skills that make a real difference, and helps others learn',
  },
] as const

export type PeerDimension = (typeof PEER_DIMENSIONS)[number]['key']
