import type { SVGProps } from 'react'

const PATHS = {
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 18l-6-6 6-6',
  check: 'M20 6L9 17l-5-5',
  checkCircle: 'M22 11.1V12a10 10 0 11-5.9-9.1M22 4L12 14.01l-3-3',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  chevronLeft: 'M15 18l-6-6 6-6',
  x: 'M18 6L6 18M6 6l12 12',
  // Four corners pushed out, and pulled in: full screen on and off.
  maximize: 'M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5',
  minimize: 'M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3',
  // The Word editor's ribbon.
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  alignLeft: 'M3 6h18M3 10h12M3 14h18M3 18h12',
  alignCenter: 'M3 6h18M6 10h12M3 14h18M6 18h12',
  alignRight: 'M3 6h18M9 10h12M3 14h18M9 18h12',
  alignJustify: 'M3 6h18M3 10h18M3 14h18M3 18h18',
  listBullet: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01',
  listNumber: 'M10 6h11M10 12h11M10 18h11M4 4v4M3 14.5a1 1 0 112 0c0 1-2 1.5-2 3h2',
  indent: 'M3 5h18M11 10h10M11 14h10M3 19h18M3 9l3 3-3 3',
  outdent: 'M3 5h18M11 10h10M11 14h10M3 19h18M7 9l-3 3 3 3',
  lineSpacing: 'M11 6h10M11 12h10M11 18h10M5 4v16M3 6l2-2 2 2M3 18l2 2 2-2',
  table: 'M3 4h18v16H3zM3 10h18M3 15h18M9 4v16M15 4v16',
  image: 'M3 4h18v16H3zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 20',
  pageBreak: 'M5 3v5h14V3M5 21v-5h14v5M2 12h3M8 12h3M14 12h3M20 12h2',
  clearFormat: 'M4 7V4h16v3M9 20h6M12 4v16M15 13l6 6M21 13l-6 6',
  highlighter: 'M9 11l-6 6v3h3l6-6M22 12l-4.6 4.6-8-8L14 4a2 2 0 012.8 0l5.2 5.2a2 2 0 010 2.8z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  // A camera body and its lens hood: meetings.
  video: 'M3 6h12v12H3zM15 10l6-3.5v11L15 14',
  videoOff: 'M3 6h12v12H3zM15 10l6-3.5v11L15 14M2 2l20 20',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
  // The same body with the shackle swung open, so the pair reads as one state.
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 017.5-2',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  users: 'M17 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9.5 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M17.9 17.9A10.5 10.5 0 0112 20c-7 0-11-8-11-8a19 19 0 015.1-5.9M9.9 4.2A10.9 10.9 0 0112 4c7 0 11 8 11 8a19 19 0 01-2.2 3.2M9.9 9.9a3 3 0 104.2 4.2M1 1l22 22',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.3a2 2 0 11-4 0v-.2a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H3a2 2 0 110-4h.2a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.2a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.2a1.6 1.6 0 00-1.4 1z',
  board: 'M3 3h18v18H3zM9 3v18M15 3v18',
  kanban: 'M6 5v10M12 5v14M18 5v7M3 3h18v18H3z',
  folder: 'M3 7a2 2 0 012-2h4l2 3h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  book: 'M12 5c-2-1.5-5-2-9-1v15c4-1 7-.5 9 1 2-1.5 5-2 9-1V4c-4-1-7-.5-9 1zM12 5v15',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  chart: 'M3 21h18M7 21V11M12 21V4M17 21v-7',
  filter: 'M4 7h16M7.5 12h9M10.5 17h3',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  palette:
    'M12 21a9 9 0 110-18c4.97 0 9 3.58 9 8 0 2.5-2 3.5-4 3.5h-1.5a1.75 1.75 0 00-1.2 3 1.75 1.75 0 01-1.3 3zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01',
  spark: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3z',
  target: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z',
  flag: 'M5 22V4M5 5c3-2 5-2 8 0s5 2 8 0v11c-3 2-5 2-8 0s-5-2-8 0',
  file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M9 15h6',
  message: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  edit: 'M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  // A two-drawer filing cabinet. It was a lidded box, which read as the bin.
  archive: 'M5 3h14v18H5zM5 12h14M10 7.5h4M10 16.5h4',
  // A clock turning back: the archive of past things, not the act of archiving.
  history: 'M3 12a9 9 0 102.6-6.4L3 8M3 3v5h5M12 7v5l3 2',
  pin: 'M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z',
  hand: 'M8 13V5a1.5 1.5 0 013 0v6-8a1.5 1.5 0 013 0v8-6a1.5 1.5 0 013 0v7-4a1.5 1.5 0 013 0v7c0 4-3 7-7 7h-2c-3 0-5-2-6-4l-2-4a1.5 1.5 0 012.5-1.5L8 15',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  dots: 'M12 6h.01M12 12h.01M12 18h.01',
  // Four rings in a square: pick how the same items are laid out.
  layoutGrid:
    'M10 7a3 3 0 11-6 0 3 3 0 016 0zM20 7a3 3 0 11-6 0 3 3 0 016 0zM10 17a3 3 0 11-6 0 3 3 0 016 0zM20 17a3 3 0 11-6 0 3 3 0 016 0z',
  // Two arrows passing each other: trade one view for the other.
  swap: 'M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM19 11a7 7 0 01-14 0M12 18v3',
  micOff: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM19 11a7 7 0 01-14 0M12 18v3M3 3l18 18',
  walkieTalkie: 'M9 6V2M7 6h10v15H7zM9 9h6v4H9zM11 17h2M17 15h2v4h-2',
  // Attach: the composer's menu of files, polls and voice on a phone.
  clip: 'M21.4 11.6l-8.8 8.8a5.5 5.5 0 01-7.8-7.8l8.8-8.8a3.7 3.7 0 015.2 5.2l-8.8 8.8a1.8 1.8 0 01-2.6-2.6l8.1-8.1',
  // The group's leader.
  crown: 'M3 7l4.5 4.5L12 5l4.5 6.5L21 7l-2 11H5zM5 21h14',
  // A class's look (lib/classLook.ts): subjects a BSIT program teaches.
  school: 'M22 9.5L12 4.5 2 9.5l10 5 10-5zM6 11.5v5c3.5 2.5 8.5 2.5 12 0v-5M22 9.5v6',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6M14 4l-4 16',
  database:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  network:
    'M12 3a2 2 0 100 4 2 2 0 000-4zM5 17a2 2 0 100 4 2 2 0 000-4zM19 17a2 2 0 100 4 2 2 0 000-4zM12 7v5M12 12l-6 5M12 12l6 5',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01M12 7h4M12 17h4',
  cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
  terminal: 'M3 5h18v14H3zM7 10l3 2.5L7 15M12 15h5',
  globe:
    'M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10c-2.5-2.7-4-6.2-4-10s1.5-7.3 4-10z',
  mobile: 'M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2zM11 18h2',
  cloud: 'M17.5 19H7a5 5 0 01-.6-9.96A6 6 0 0118 10a4.5 4.5 0 01-.5 9z',
  brain:
    'M12 5a3 3 0 00-5.8-1.1A3 3 0 003.5 8a3 3 0 00.4 5A3.5 3.5 0 007 19a3 3 0 005 1.2zM12 5a3 3 0 015.8-1.1A3 3 0 0120.5 8a3 3 0 01-.4 5 3.5 3.5 0 01-3.1 6 3 3 0 01-5 1.2M12 5v15',
  math: 'M9 20c2 0 2.5-1.5 3-4l2-9c.5-2.5 1-4 3-4M7 10h9M15 14l5 6M20 14l-5 6',
  flask: 'M9 3h6M10 3v6l-5.4 9.3A1.8 1.8 0 006.2 21h11.6a1.8 1.8 0 001.6-2.7L14 9V3M7 15h10',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  language: 'M4 5h8M8 3v2M10 5c-1 4-3.5 7-6 8M6 9c1 2 3 3.5 5 4M13 21l4-9 4 9M14.5 18h5',
  briefcase: 'M3 8h18v12H3zM8 8V5a1 1 0 011-1h6a1 1 0 011 1v3M3 13h18',
  presentation: 'M3 4h18M4 4v10h16V4M12 14v4M8 21l4-3 4 3M8 11l3-3 2 2 3-3',
  certificate: 'M5 3h14v12H5zM9 7h6M9 10h4M10 15l-1 6 3-2 3 2-1-6',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.5-6.9A2 2 0 0016.8 4H7.2a2 2 0 00-1.7 1.1z',
  trendUp: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  // Task type icons (lib/taskTypes/icons.ts). Shapes follow Lucide's (lucide.dev, ISC licence),
  // redrawn as one path each in this set's stroke.
  squareCheck: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM9 12l2 2 4-4',
  bug: 'M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 016 0v1.1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M21 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4',
  rocket: 'M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 00-2.9-.1zM12 15l-3-3a22 22 0 012-3.9A12.9 12.9 0 0122 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 01-4 2zM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5',
  layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  userPlus: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6',
  userMinus: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 11h-6',
  userSearch: 'M10 14a5 5 0 100-10 5 5 0 000 10zM2 21a8 8 0 0110.4-7.6M18 21a3 3 0 100-6 3 3 0 000 6zM22 22l-1.9-1.9',
  listTodo: 'M13 5h8M13 12h8M13 19h8M3 17l2 2 4-4M3 4h6v6H3z',
  listChecks: 'M3 17l2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8',
  clipboardCheck: 'M9 2h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1V3a1 1 0 011-1zM16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2M9 14l2 2 4-4',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  package: 'M11 21.7a2 2 0 002 0l7-4a2 2 0 001-1.7V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7zM12 22V12M3.3 7L12 12l8.7-5M7.5 4.3l9 5.1',
  fileText: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  circleAlert: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 8v4M12 16h.01',
  filePen: 'M12.5 22H18a2 2 0 002-2V7l-5-5H6a2 2 0 00-2 2v9.5M14 2v4a2 2 0 002 2h4M13.4 12.6a2 2 0 113 3L10 22l-4 1 1-4z',
  shieldCheck: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  shieldAlert: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 8v4M12 16h.01',
  scale: 'M16 16l3-8 3 8c-.9.7-1.9 1-3 1s-2.1-.3-3-1zM2 16l3-8 3 8c-.9.7-1.9 1-3 1s-2.1-.3-3-1zM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2',
  pieChart: 'M21.2 15.9A10 10 0 118 2.8M22 12A10 10 0 0012 2v10z',
  calculator: 'M6 2h12a2 2 0 012 2v16a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zM8 6h8M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01',
  hardHat: 'M2 18a1 1 0 001 1h18a1 1 0 001-1v-2a1 1 0 00-1-1H3a1 1 0 00-1 1zM10 10V5a1 1 0 011-1h2a1 1 0 011 1v5M4 15v-3a6 6 0 016-6M14 6a6 6 0 016 6v3',
  shovel: 'M2 22l1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 113 3L18 9l.7.7a2.4 2.4 0 010 3.4L16 15.8a2.4 2.4 0 01-3.4 0l-4.4-4.4a2.4 2.4 0 010-3.4L11 5.3a2.4 2.4 0 013.4 0z',
  shoppingCart: 'M8 22a1 1 0 100-2 1 1 0 000 2zM19 22a1 1 0 100-2 1 1 0 000 2zM2 2h2l2.7 12.4a2 2 0 002 1.6h9.7a2 2 0 002-1.6L21.8 7H5.1',
  wrench: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.8-3.8a6 6 0 01-7.9 7.9l-6.9 6.9a2.1 2.1 0 01-3-3l6.9-6.9a6 6 0 017.9-7.9z',
  scanSearch: 'M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M12 15a3 3 0 100-6 3 3 0 000 6zM17 17l-2.1-2.1',
  scanEye: 'M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M12 13a1 1 0 100-2 1 1 0 000 2zM18.9 12.4a7.4 7.4 0 00-13.8 0 7.4 7.4 0 0013.8 0z',
  fileCheck: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M9 15l2 2 4-4',
  fileChart: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M8 18v-2M12 18v-4M16 18v-6',
  handshake: 'M11 17l2 2a1 1 0 103-3M14 14l2.5 2.5a1 1 0 103-3l-3.9-3.9a3 3 0 00-4.2 0l-.9.9a1 1 0 11-3-3l2.8-2.8a5.8 5.8 0 017.1-.9l.5.3a2 2 0 001.4.3L21 4M21 3l1 11h-2M3 3L2 14l6.5 6.5a1 1 0 103-3M3 4h8',
  building: 'M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18zM6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
  key: 'M7.5 21a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM11.4 11.6L21 2M15.5 7.5l3 3L22 7l-3-3',
  mapPin: 'M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 01-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0116 0zM12 13a3 3 0 100-6 3 3 0 000 6z',
  megaphone: 'M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 11-5.8-1.6',
  wallet: 'M19 7V4a1 1 0 00-1-1H5a2 2 0 000 4h15a1 1 0 011 1v4h-3a2 2 0 000 4h3a1 1 0 001-1v-2a1 1 0 00-1-1M3 5v14a2 2 0 002 2h15a1 1 0 001-1v-4',
  lightbulb: 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 006 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4',
  penTool: 'M15.7 21.3a1 1 0 01-1.4 0l-1.6-1.6a1 1 0 010-1.4l5.6-5.6a1 1 0 011.4 0l1.6 1.6a1 1 0 010 1.4zM18 13l-1.4-6.9a1 1 0 00-.8-.8L2.9 2.1a.5.5 0 00-.6.6l3.2 12.9a1 1 0 00.8.8L13 18M2.3 2.3l7.3 7.3M11 13a2 2 0 100-4 2 2 0 000 4z',
  radio: 'M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M12 14a2 2 0 100-4 2 2 0 000 4zM16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  truck: 'M14 18V6a2 2 0 00-2-2H4a2 2 0 00-2 2v11a1 1 0 001 1h2M15 18H9M19 18h2a1 1 0 001-1v-3.6a1 1 0 00-.2-.6l-3.5-4.4A1 1 0 0017.5 8H14M17 20a2 2 0 100-4 2 2 0 000 4zM7 20a2 2 0 100-4 2 2 0 000 4z',
  monitorPlay: 'M3 3h18v14H3zM12 17v4M8 21h8M10 7.5v5l4-2.5z',
  scissors: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.1 15.9M14.5 14.8L20 20M8.1 8.1L12 12',
  messagesSquare: 'M14 9a2 2 0 01-2 2H6l-4 4V4a2 2 0 012-2h8a2 2 0 012 2zM18 9h2a2 2 0 012 2v11l-4-4h-6a2 2 0 01-2-2v-1',
  workflow: 'M3 3h6v6H3zM15 15h6v6h-6zM7 9v4a2 2 0 002 2h6',
  draftingCompass: 'M12 7a2 2 0 100-4 2 2 0 000 4zM10.9 6.7L4 20M13.1 6.7L20 20M4.5 14.5a10 10 0 0015 0',
  factory: 'M2 20a2 2 0 002 2h16a2 2 0 002-2V8l-7 5V8l-7 5V4a2 2 0 00-2-2H4a2 2 0 00-2 2zM17 18h1M12 18h1M7 18h1',
  receipt: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1zM16 8h-6a2 2 0 000 4h4a2 2 0 010 4H8M12 17.5v-11',
  arrowLeftRight: 'M8 3L4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4',
  tag: 'M12.6 2.6A2 2 0 0011.2 2H4a2 2 0 00-2 2v7.2a2 2 0 00.6 1.4l8.7 8.7a2.4 2.4 0 003.4 0l6.6-6.6a2.4 2.4 0 000-3.4zM7.5 8a.5.5 0 100-1 .5.5 0 000 1z',
} as const

export type IconName = keyof typeof PATHS

type Props = SVGProps<SVGSVGElement> & { name: IconName; size?: number }

export function Icon({ name, size = 20, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export function MicrosoftMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 00-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
