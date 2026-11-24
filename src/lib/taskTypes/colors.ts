// src/lib/taskTypes/colors.ts
/**
 * The named colors a task type's picker offers. They are values a person picks, like a project's own
 * color, not styling, so they live here as data and are drawn through lib/taskTypes/look.ts.
 */
export const TYPE_SWATCHES: readonly { name: string; hex: string }[] = [
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Cyan', hex: '#0891b2' },
  { name: 'Purple', hex: '#9333ea' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Amber', hex: '#d97706' },
  { name: 'Teal', hex: '#0d9488' },
  { name: 'Magenta', hex: '#db2777' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Orange', hex: '#ea580c' },
  { name: 'Slate', hex: '#64748b' },
  { name: 'Ochre', hex: '#a16207' },
  { name: 'Violet', hex: '#7c3aed' },
]

/** The swatch's name for a hex, or the hex itself. */
export const swatchName = (hex: string) => TYPE_SWATCHES.find((s) => s.hex === hex.toLowerCase())?.name ?? hex.toUpperCase()
