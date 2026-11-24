// src/lib/taskTypes/icons.ts
/** The icons a task type may wear, in the order the editor's grid shows them (supabase/task-type-looks.sql). */
import type { IconName } from '../../components/ui/Icon'

export const TASK_TYPE_ICONS = [
  'square-check', 'bug', 'rocket', 'layers', 'user-plus', 'list-todo', 'clipboard-check', 'zap', 'package',
  'list-checks', 'file-text', 'circle-alert', 'circle-check', 'search', 'target', 'book-open', 'database',
  'chart', 'flask', 'file-pen', 'shield-check', 'square-pen', 'scale', 'pie-chart', 'cog', 'calculator',
  'users', 'globe', 'shield-alert', 'hard-hat', 'shovel', 'shopping-cart', 'wrench', 'scan-search',
  'file-check', 'triangle-alert', 'handshake', 'building', 'key', 'map-pin', 'megaphone', 'wallet',
  'lightbulb', 'pen-tool', 'palette', 'radio', 'send', 'calendar', 'truck', 'monitor-play', 'image',
  'scissors', 'scan-eye', 'refresh-cw', 'user-search', 'filter', 'messages-square', 'graduation-cap',
  'user-minus', 'briefcase', 'workflow', 'inbox', 'drafting-compass', 'factory', 'receipt',
  'arrow-left-right', 'file-chart', 'tag',
] as const

export type TaskTypeIcon = (typeof TASK_TYPE_ICONS)[number]

/** Each key's glyph in the app's icon set; a few keys reuse a glyph the set already had. */
export const TYPE_ICON_GLYPH: Record<TaskTypeIcon, IconName> = {
  'square-check': 'squareCheck',
  bug: 'bug',
  rocket: 'rocket',
  layers: 'layers',
  'user-plus': 'userPlus',
  'list-todo': 'listTodo',
  'clipboard-check': 'clipboardCheck',
  zap: 'zap',
  package: 'package',
  'list-checks': 'listChecks',
  'file-text': 'fileText',
  'circle-alert': 'circleAlert',
  'circle-check': 'checkCircle',
  search: 'search',
  target: 'target',
  'book-open': 'book',
  database: 'database',
  chart: 'chart',
  flask: 'flask',
  'file-pen': 'filePen',
  'shield-check': 'shieldCheck',
  'square-pen': 'edit',
  scale: 'scale',
  'pie-chart': 'pieChart',
  cog: 'settings',
  calculator: 'calculator',
  users: 'users',
  globe: 'globe',
  'shield-alert': 'shieldAlert',
  'hard-hat': 'hardHat',
  shovel: 'shovel',
  'shopping-cart': 'shoppingCart',
  wrench: 'wrench',
  'scan-search': 'scanSearch',
  'file-check': 'fileCheck',
  'triangle-alert': 'alert',
  handshake: 'handshake',
  building: 'building',
  key: 'key',
  'map-pin': 'mapPin',
  megaphone: 'megaphone',
  wallet: 'wallet',
  lightbulb: 'lightbulb',
  'pen-tool': 'penTool',
  palette: 'palette',
  radio: 'radio',
  send: 'send',
  calendar: 'calendar',
  truck: 'truck',
  'monitor-play': 'monitorPlay',
  image: 'image',
  scissors: 'scissors',
  'scan-eye': 'scanEye',
  'refresh-cw': 'refresh',
  'user-search': 'userSearch',
  filter: 'filter',
  'messages-square': 'messagesSquare',
  'graduation-cap': 'school',
  'user-minus': 'userMinus',
  briefcase: 'briefcase',
  workflow: 'workflow',
  inbox: 'inbox',
  'drafting-compass': 'draftingCompass',
  factory: 'factory',
  receipt: 'receipt',
  'arrow-left-right': 'arrowLeftRight',
  'file-chart': 'fileChart',
  tag: 'tag',
}

export const isTaskTypeIcon = (value: unknown): value is TaskTypeIcon =>
  typeof value === 'string' && (TASK_TYPE_ICONS as readonly string[]).includes(value)

/** "square-check" reads "Square check". */
export function typeIconLabel(key: TaskTypeIcon): string {
  const words = key.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
