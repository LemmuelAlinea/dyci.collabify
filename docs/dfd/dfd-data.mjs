// The Collabify DFDs as data: what is on each diagram and where it sits.
// build-dfd.mjs turns this into SVG, PNG and draw.io.

// ---------- Level 0 flows (the balance check holds Level 1 to these) ----------
// dir is from Collabify's side: 'in' flows into Collabify, 'out' flows out.

export const FLOWS = {
  S: {
    name: 'Student',
    in: ['sign-up and sign-in details', 'privacy requests', 'class join code', 'group choices', 'task updates', 'hand-ins', 'peer ratings', 'files', 'messages'],
    out: ['class details', 'project briefs', 'held tasks', 'grades and feedback', 'project files', 'messages and announcements', 'notifications'],
  },
  T: {
    name: 'Teaching member',
    in: ['sign-up and sign-in details', 'privacy requests', 'class details', 'syllabi', 'group sets', 'project briefs and rubrics', 'hand-in decisions', 'scores', 'reassignment decisions', 'announcements', 'messages'],
    out: ['class rosters', 'hand-ins', 'peer evaluation results', 'group files', 'class analytics and reports', 'messages and announcements', 'notifications'],
  },
  W: {
    name: 'Work-project member',
    in: ['sign-up and sign-in details', 'privacy requests', 'space and project details', 'roles and roster files', 'stakeholder feedback', 'tasks and routing decisions', 'QA decisions', 'sprint and milestone plans', 'workflow rules', 'files and reviews', 'messages and meetings'],
    out: ['project details', 'feedback replies', 'task boards', 'project files', 'progress and reports', 'messages and announcements', 'notifications'],
  },
  A: {
    name: 'Admin',
    in: ['sign-in details', 'accounts and switches', 'bulk registration file', 'offboarding choices', 'offices and heads', 'organization settings', 'sections and program library', 'privacy decisions', 'project manager assignments', 'program notices'],
    out: ['account directory', 'organization overview', 'audit log and privacy queue', 'work project list', 'program oversight figures', 'notifications'],
  },
  E: { name: 'Email service (Brevo)', in: [], out: ['confirmation and reset emails'] },
  M: { name: 'Microsoft sign-in', in: ['identity confirmation'], out: ['sign-in request'] },
  AI: {
    name: 'AI services (Claude, Groq Whisper)',
    in: ['extracted syllabus weeks', 'brief and rubric drafts', 'roster review', 'task drafts and holder suggestions', 'file summaries and answers', 'transcripts'],
    out: ['syllabus files', 'brief prompts', 'roster files', 'task prompts', 'file contents and questions', 'voice recordings'],
  },
  O: { name: 'OneSignal', in: [], out: ['device notifications'] },
}

const it = (ent, dir, items) => ({ ent, dir, items })

// ---------- Level 0 ----------

export function level0(makeDiagram, { wrap }) {
  const sizes = { entity: 17, process: 22, num: 18, store: 15, flow: 14, band: 36, storeId: 42, arrow: 10 }
  const d = makeDiagram('Level 0 - Context diagram', 1600, 1000, sizes)
  const lab = (items) => wrap(items.join(', '), sizes.flow, 330).join('\n')

  const P = d.process('P0', '0', 'Collabify', 600, 270, 400, 460)

  d.entity('S', 'S', FLOWS.S.name, 40, 300, 200, 90)
  d.entity('T', 'T', FLOWS.T.name, 40, 640, 200, 90)
  d.entity('W', 'W', FLOWS.W.name, 1360, 300, 200, 90)
  d.entity('A', 'A', FLOWS.A.name, 1360, 640, 200, 90)
  d.entity('E', 'E', 'Email service (Brevo)', 600, 50, 190, 80)
  d.entity('M', 'M', 'Microsoft sign-in', 850, 50, 190, 80)
  d.entity('AI', 'AI', 'AI services (Claude, Groq Whisper)', 590, 870, 210, 80)
  d.entity('O', 'O', 'OneSignal', 870, 870, 190, 80)

  // People on the left feed the process's left side; on the right, its right side.
  for (const [id, y] of [['S', 330], ['T', 670]]) {
    d.edge(id, P.id, [[420, y]], lab(FLOWS[id].in), { items: [it(id, 'in', FLOWS[id].in)] })
    d.edge(P.id, id, [[420, y + 30]], lab(FLOWS[id].out), { side: 'b', items: [it(id, 'out', FLOWS[id].out)] })
  }
  for (const [id, y] of [['W', 330], ['A', 670]]) {
    d.edge(id, P.id, [[1180, y]], lab(FLOWS[id].in), { items: [it(id, 'in', FLOWS[id].in)] })
    d.edge(P.id, id, [[1180, y + 30]], lab(FLOWS[id].out), { side: 'b', items: [it(id, 'out', FLOWS[id].out)] })
  }

  d.edge(P.id, 'E', [[680, 200]], 'confirmation and\nreset emails', { side: 'l', items: [it('E', 'out', FLOWS.E.out)] })
  d.edge(P.id, 'M', [[890, 200]], 'sign-in\nrequest', { side: 'l', items: [it('M', 'out', FLOWS.M.out)] })
  d.edge('M', P.id, [[980, 200]], 'identity\nconfirmation', { items: [it('M', 'in', FLOWS.M.in)] })
  d.edge(P.id, 'AI', [[640, 800]], 'prompts with text, files\nand voice recordings', { side: 'l', items: [it('AI', 'out', FLOWS.AI.out)] })
  d.edge('AI', P.id, [[750, 800]], 'drafts, extracted weeks,\ntranscripts, answers', { items: [it('AI', 'in', FLOWS.AI.in)] })
  d.edge(P.id, 'O', [[980, 800]], 'device\nnotifications', { items: [it('O', 'out', FLOWS.O.out)] })
  return d
}

// ---------- Level 1 ----------

export function level1(makeDiagram) {
  const sizes = { entity: 15, process: 16, num: 15, store: 14, flow: 14, band: 30, storeId: 40, arrow: 9 }
  const d = makeDiagram('Level 1 - Collabify', 2200, 1480, sizes)

  // Grid: five columns, a top row of processes, the stores, a bottom row.
  const X = [420, 780, 1140, 1500, 1860]
  const PW = 300
  const PH = 110
  const TOP = 360
  const BOT = 990
  const SY = 700
  const SH = 58
  const SW = 165
  const left = (c) => X[c] - 8 - SW
  const right = (c) => X[c] + 8
  const px = (c) => X[c] - PW / 2

  d.process('P1', '1.0', 'Manage accounts and access', px(0), TOP, PW, PH)
  d.process('P2', '2.0', 'Administer organization and compliance', px(1), TOP, PW, PH)
  d.process('P3', '3.0', 'Manage classes and groups', px(2), TOP, PW, PH)
  d.process('P4', '4.0', 'Run class projects and grading', px(3), TOP, PW, PH)
  d.process('P5', '5.0', 'Produce reports and analytics', px(4), TOP, PW, PH)
  d.process('P6', '6.0', 'Communicate and meet', px(0), BOT, PW, PH)
  d.process('P7', '7.0', 'Send notifications and reminders', px(1), BOT, PW, PH)
  d.process('P8', '8.0', 'Manage work spaces and projects', px(2), BOT, PW, PH)
  d.process('P9', '9.0', 'Plan, assign and track tasks', px(3), BOT, PW, PH)
  d.process('P10', '10.0', 'Manage files and reviews', px(4), BOT, PW, PH)

  d.store('D1', 'D1', 'Accounts', left(0), SY, SW, SH)
  d.store('D8', 'D8', 'Messages and meetings', right(0), SY, SW, SH)
  d.store('D9', 'D9', 'Notifications', left(1), SY, SW, SH)
  d.store('D10', 'D10', 'Organization records', right(1), SY, SW, SH)
  d.store('D3', 'D3', 'Syllabi and curriculum', left(2), SY, SW, SH)
  d.store('D2', 'D2', 'Classes and groups', right(2), SY, SW, SH)
  d.store('D5', 'D5', 'Spaces and projects', left(3), SY, SW, SH)
  d.store('D6', 'D6', 'Tasks', right(3), SY, SW, SH)
  d.store('D4', 'D4', 'Class projects and grades', left(4), SY, SW, SH)
  d.store('D7', 'D7', 'File repository', right(4), SY, SW, SH)

  const pt = (id) => d.nodes[id]
  const bus = (prefix, x, ys) => ys.map((y, i) => d.junction(`${prefix}${i}`, x, y))

  // A straight vertical flow at x between two nodes.
  const V = (from, to, x, label, opts = {}) => {
    const a = pt(from)
    const b = pt(to)
    return d.edge(from, to, [[x, (a.y + a.h / 2 + b.y + b.h / 2) / 2]], label, opts)
  }
  // Label anchored right (R) or left (L) of a vertical line at x, centred on y.
  const R = (x, y) => ({ x: x + 7, y, anchor: 'start' })
  const L = (x, y) => ({ x: x - 7, y, anchor: 'end' })
  const tiersTop = [140, 205, 270, 332]
  const tiersBot = [1150, 1205, 1260, 1305]

  // ----- 1.0 Manage accounts and access -----
  const stackTop = [['S0', 'S'], ['T0', 'T'], ['W0', 'W'], ['A0', 'A']]
  stackTop.forEach(([id, base], i) => d.entity(id, base, FLOWS[base].name, 20, 40 + i * 62, 180, 50))
  const j1 = bus('j1-', 230, stackTop.map((_, i) => 65 + i * 62))
  stackTop.forEach(([id], i) => d.edge(id, j1[i].id, [[230, 65 + i * 62]], '', { arrow: false }))
  d.junction('j1-in', 230, 400)
  d.edge('j1-0', 'j1-in', [[230, 230]], '', { arrow: false })
  d.edge('j1-in', 'P1', [[250, 400]], 'sign-up and sign-in details,\nprivacy requests', {
    lab: { x: 240, y: 318, anchor: 'start' },
    items: [
      it('S', 'in', ['sign-up and sign-in details', 'privacy requests']),
      it('T', 'in', ['sign-up and sign-in details', 'privacy requests']),
      it('W', 'in', ['sign-up and sign-in details', 'privacy requests']),
      it('A', 'in', ['sign-in details']),
    ],
  })
  d.entity('M1', 'M', FLOWS.M.name, 20, 420, 150, 64)
  d.edge('P1', 'M1', [[220, 432]], 'sign-in request', { lab: { x: 220, y: 500, anchor: 'middle' }, items: [it('M', 'out', ['sign-in request'])] })
  d.edge('M1', 'P1', [[220, 462]], 'identity\nconfirmation', { lab: { x: 220, y: 540, anchor: 'middle' }, items: [it('M', 'in', ['identity confirmation'])] })
  d.entity('E1', 'E', FLOWS.E.name, 20, 600, 150, 64)
  d.edge('P1', 'E1', [[285, 632]], 'confirmation\nand reset\nemails', { lab: { x: 228, y: 594, anchor: 'middle' }, items: [it('E', 'out', ['confirmation and reset emails'])] })

  d.entity('A1', 'A', FLOWS.A.name, 650, 40, 170, 60)
  d.edge('A1', 'P1', [[480, 60]], 'accounts and switches,\nbulk registration file,\noffboarding choices', {
    lab: L(480, 200),
    items: [it('A', 'in', ['accounts and switches', 'bulk registration file', 'offboarding choices'])],
  })
  d.edge('P1', 'A1', [[530, 88]], 'account\ndirectory', { lab: R(530, 140), items: [it('A', 'out', ['account directory'])] })
  V('P1', 'D1', 350, 'account\ndetails', { lab: L(350, 560) })
  V('D1', 'P1', 400, 'account\nstatus', { lab: R(400, 540) })
  d.edge('P1', 'D10', [[600, 440], [600, 650], [800, 650]], 'audit entries,\nprivacy requests', { lab: { x: 700, y: 625, anchor: 'middle' } })

  // ----- 2.0 Administer organization and compliance -----
  V('A1', 'P2', 700, 'offices and heads,\norganization settings,\nsections and program library,\nprivacy decisions', {
    lab: L(700, 290),
    items: [it('A', 'in', ['offices and heads', 'organization settings', 'sections and program library', 'privacy decisions'])],
  })
  V('P2', 'A1', 780, 'organization overview,\naudit log and privacy queue', {
    lab: R(780, 200),
    items: [it('A', 'out', ['organization overview', 'audit log and privacy queue'])],
  })
  V('P2', 'D10', 850, 'offices, settings,\nprivacy decisions', { lab: L(850, 560) })
  V('D10', 'P2', 900, 'audit log,\nprivacy\nrequests', { lab: R(900, 525) })
  d.edge('P2', 'D3', [[975, 430], [975, 650]], 'sections,\nprogram\nlibrary', { lab: R(975, 610) })

  // ----- 3.0 Manage classes and groups and 4.0 Run class projects and grading -----
  d.entity('S1', 'S', FLOWS.S.name, 995, 40, 95, 60)
  d.entity('T1', 'T', FLOWS.T.name, 1100, 40, 95, 60)
  d.entity('AI1', 'AI', FLOWS.AI.name, 1210, 40, 230, 60)
  d.entity('S2', 'S', FLOWS.S.name, 1455, 40, 95, 60)
  d.entity('T2', 'T', FLOWS.T.name, 1560, 40, 95, 60)
  const top = [
    ['S1', 'P3', 1015, 'class join code,\ngroup choices', it('S', 'in', ['class join code', 'group choices'])],
    ['P3', 'S1', 1060, 'class details', it('S', 'out', ['class details'])],
    ['T1', 'P3', 1125, 'class details, syllabi,\ngroup sets', it('T', 'in', ['class details', 'syllabi', 'group sets'])],
    ['P3', 'T1', 1170, 'class rosters', it('T', 'out', ['class rosters'])],
    ['AI1', 'P3', 1230, 'extracted\nsyllabus weeks', it('AI', 'in', ['extracted syllabus weeks'])],
    ['P3', 'AI1', 1270, 'syllabus files', it('AI', 'out', ['syllabus files'])],
    ['AI1', 'P4', 1375, 'brief and\nrubric drafts', it('AI', 'in', ['brief and rubric drafts'])],
    ['P4', 'AI1', 1415, 'brief prompts', it('AI', 'out', ['brief prompts'])],
    ['S2', 'P4', 1480, 'task updates,\nhand-ins,\npeer ratings', it('S', 'in', ['task updates', 'hand-ins', 'peer ratings'])],
    ['P4', 'S2', 1525, 'project briefs,\nheld tasks,\ngrades and feedback', it('S', 'out', ['project briefs', 'held tasks', 'grades and feedback'])],
    ['T2', 'P4', 1585, 'project briefs and rubrics,\nhand-in decisions, scores,\nreassignment decisions', it('T', 'in', ['project briefs and rubrics', 'hand-in decisions', 'scores', 'reassignment decisions'])],
    ['P4', 'T2', 1630, 'hand-ins,\npeer evaluation results', it('T', 'out', ['hand-ins', 'peer evaluation results'])],
  ]
  top.forEach(([a, b, x, label, flow], i) => V(a, b, x, label, { lab: R(x, tiersTop[i % 4]), items: [flow] }))
  d.edge('P3', 'P4', [[1320, 395]], 'syllabus\nweeks', { lab: { x: 1320, y: 452, anchor: 'middle' } })
  V('P3', 'D3', 1020, 'syllabi', { lab: R(1020, 560) })
  V('P3', 'D2', 1180, 'classes, rosters,\ngroups', { lab: R(1180, 620) })
  d.edge('D2', 'P4', [[1300, 650], [1400, 650]], 'groups', { lab: R(1400, 560) })
  V('P4', 'D6', 1560, 'class board\ntasks', { lab: R(1560, 610) })
  d.edge('P4', 'D4', [[1695, 420]], 'briefs, rubrics,\nhand-ins, scores', { lab: L(1695, 520) })

  // ----- 5.0 Produce reports and analytics -----
  V('D4', 'P5', 1810, 'grades,\npeer results', { lab: R(1810, 620) })
  V('D7', 'P5', 1960, 'commits,\nreviews', { lab: R(1960, 560) })
  d.edge('D6', 'P5', [[1665, 660], [1740, 660]], 'task activity', { lab: R(1740, 520) })
  const fanR = [['T3', 'T', 352], ['W3', 'W', 418], ['A3', 'A', 484]]
  fanR.forEach(([id, base, cy]) => d.entity(id, base, FLOWS[base].name, 2060, cy - 28, 130, 56))
  d.junction('j5-t', 2040, 352)
  d.junction('j5-m', 2040, 418)
  d.junction('j5-b', 2040, 484)
  d.edge('P5', 'j5-m', [[2025, 418]], 'reports and\nanalytics', {
    arrow: false,
    lab: { x: 2125, y: 296, anchor: 'middle' },
    items: [
      it('T', 'out', ['class analytics and reports']),
      it('W', 'out', ['progress and reports']),
      it('A', 'out', ['program oversight figures']),
    ],
  })
  d.edge('j5-m', 'j5-t', [[2040, 385]], '', { arrow: false })
  d.edge('j5-m', 'j5-b', [[2040, 450]], '', { arrow: false })
  fanR.forEach(([id, , cy], i) => d.edge(['j5-t', 'j5-m', 'j5-b'][i], id, [[2050, cy]], ''))

  // ----- 6.0 Communicate and meet -----
  const stackBot = [['S5', 'S'], ['T5', 'T'], ['W5', 'W'], ['A5', 'A']]
  stackBot.forEach(([id, base], i) => d.entity(id, base, FLOWS[base].name, 20, 870 + i * 62, 180, 50))
  const j6 = bus('j6-', 230, stackBot.map((_, i) => 895 + i * 62))
  stackBot.forEach(([id], i) => d.edge(id, j6[i].id, [[230, 895 + i * 62]], '', { arrow: false }))
  d.junction('j6-in', 230, 1045)
  d.edge('j6-0', 'j6-3', [[230, 990]], '', { arrow: false })
  d.edge('j6-in', 'P6', [[250, 1045]], 'messages, announcements,\nmeetings, program notices', {
    lab: { x: 20, y: 835, anchor: 'start' },
    items: [
      it('S', 'in', ['messages']),
      it('T', 'in', ['announcements', 'messages']),
      it('W', 'in', ['messages and meetings']),
      it('A', 'in', ['program notices']),
    ],
  })
  V('P6', 'D8', 450, 'messages, notices,\nmeetings', { lab: L(450, 860) })
  V('D8', 'P6', 510, 'conversations', { lab: R(510, 930) })
  d.entity('AI4', 'AI', FLOWS.AI.name, 20, 1170, 180, 64)
  d.edge('P6', 'AI4', [[300, 1190]], 'voice\nrecordings', { lab: R(300, 1140), items: [it('AI', 'out', ['voice recordings'])] })
  d.edge('AI4', 'P6', [[370, 1222]], 'transcripts', { lab: R(370, 1190), items: [it('AI', 'in', ['transcripts'])] })

  // People below 6.0 and 7.0: 6.0's fan reaches their tops, 7.0's their bottoms.
  const cluster = [['S6', 'S', 280], ['T6', 'T', 425], ['W6', 'W', 570], ['A6', 'A', 715]]
  cluster.forEach(([id, base, x]) => d.entity(id, base, FLOWS[base].name, x, 1330, 130, 56))
  d.junction('j6-f', 540, 1280)
  d.edge('P6', 'j6-f', [[540, 1200]], 'messages and\nannouncements', {
    arrow: false,
    lab: R(540, 1150),
    items: [it('S', 'out', ['messages and announcements']), it('T', 'out', ['messages and announcements']), it('W', 'out', ['messages and announcements'])],
  })
  cluster.slice(0, 3).forEach(([id, , x], i) => {
    d.junction(`j6-f${i}`, x + 65, 1280)
    d.edge('j6-f', `j6-f${i}`, [[(540 + x + 65) / 2, 1280]], '', { arrow: false })
    d.edge(`j6-f${i}`, id, [[x + 65, 1300]], '')
  })

  // ----- 7.0 Send notifications and reminders -----
  d.junction('j7-f', 905, 1430)
  d.edge('P7', 'j7-f', [[905, 1300]], 'notifications', {
    arrow: false,
    lab: { x: 600, y: 1450, anchor: 'middle' },
    items: ['S', 'T', 'W', 'A'].map((e) => it(e, 'out', ['notifications'])),
  })
  cluster.forEach(([id, , x], i) => {
    d.junction(`j7-f${i}`, x + 65, 1430)
    d.edge('j7-f', `j7-f${i}`, [[(905 + x + 65) / 2, 1430]], '', { arrow: false })
    d.edge(`j7-f${i}`, id, [[x + 65, 1410]], '')
  })
  d.entity('O1', 'O', FLOWS.O.name, 930, 1330, 125, 56)
  d.edge('P7', 'O1', [[960, 1080], [960, 1200]], 'device\nnotifications', { lab: R(960, 1250), items: [it('O', 'out', ['device notifications'])] })
  V('P7', 'D9', 650, 'notifications', { lab: R(650, 830) })
  V('D9', 'P7', 760, 'preferences,\ndevices', { lab: R(760, 910) })
  d.edge('D8', 'P7', [[590, 800], [590, 1030]], 'new messages\nand notices', { lab: L(590, 800) })

  // ----- 8.0 Manage work spaces and projects -----
  d.entity('W7', 'W', FLOWS.W.name, 1070, 1330, 100, 70)
  d.entity('A7', 'A', FLOWS.A.name, 1185, 1330, 100, 70)
  const bot8 = [
    ['W7', 'P8', 1095, 'space and project details,\nroles and roster files,\nstakeholder feedback', it('W', 'in', ['space and project details', 'roles and roster files', 'stakeholder feedback'])],
    ['P8', 'W7', 1145, 'project details,\nfeedback replies', it('W', 'out', ['project details', 'feedback replies'])],
    ['A7', 'P8', 1210, 'project manager\nassignments', it('A', 'in', ['project manager assignments'])],
    ['P8', 'A7', 1260, 'work project list', it('A', 'out', ['work project list'])],
  ]
  bot8.forEach(([a, b, x, label, flow], i) => V(a, b, x, label, { lab: R(x, tiersBot[i]), items: [flow] }))
  d.edge('P8', 'D5', [[1010, 820], [1340, 820]], 'spaces, projects,\nroles, feedback', { lab: { x: 1100, y: 846, anchor: 'start' } })
  d.entity('AI2', 'AI', FLOWS.AI.name, 1230, 845, 180, 60)
  V('P8', 'AI2', 1250, 'roster files', { lab: L(1250, 930), items: [it('AI', 'out', ['roster files'])] })
  V('AI2', 'P8', 1280, 'roster review', { lab: L(1280, 962), items: [it('AI', 'in', ['roster review'])] })

  // ----- 9.0 Plan, assign and track tasks -----
  V('P9', 'AI2', 1365, 'task prompts', { lab: R(1365, 925), items: [it('AI', 'out', ['task prompts'])] })
  V('AI2', 'P9', 1395, 'task drafts and\nholder suggestions', { lab: R(1395, 960), items: [it('AI', 'in', ['task drafts and holder suggestions'])] })
  V('D5', 'P9', 1460, 'teams, positions,\nskills', { lab: R(1460, 800) })
  V('P9', 'D6', 1540, 'tasks, sprints,\nmilestones', { lab: R(1540, 860) })
  V('D6', 'P9', 1630, 'task\nrecords', { lab: R(1630, 790) })
  d.edge('P9', 'P7', [[1420, 800], [900, 800]], 'task events', { lab: { x: 1150, y: 786, anchor: 'middle' } })
  d.entity('W8', 'W', FLOWS.W.name, 1420, 1330, 160, 60)
  V('W8', 'P9', 1450, 'tasks and routing decisions,\nQA decisions, sprint and\nmilestone plans, workflow rules', {
    lab: R(1450, 1160),
    items: [it('W', 'in', ['tasks and routing decisions', 'QA decisions', 'sprint and milestone plans', 'workflow rules'])],
  })
  V('P9', 'W8', 1545, 'task boards', { lab: R(1545, 1245), items: [it('W', 'out', ['task boards'])] })

  // ----- 10.0 Manage files and reviews -----
  V('P10', 'D7', 1900, 'commits, drafts,\nreviews', { lab: L(1900, 800) })
  V('D7', 'P10', 1960, 'file versions', { lab: R(1960, 860) })
  d.entity('AI3', 'AI', FLOWS.AI.name, 1715, 855, 160, 60)
  V('P10', 'AI3', 1740, 'file contents\nand questions', { lab: L(1740, 950), items: [it('AI', 'out', ['file contents and questions'])] })
  V('AI3', 'P10', 1790, 'file summaries\nand answers', { lab: R(1790, 955), items: [it('AI', 'in', ['file summaries and answers'])] })
  d.entity('S9', 'S', FLOWS.S.name, 1700, 1330, 100, 60)
  d.entity('T9', 'T', FLOWS.T.name, 1815, 1330, 110, 60)
  d.entity('W9', 'W', FLOWS.W.name, 1940, 1330, 140, 60)
  const bot10 = [
    ['S9', 'P10', 1725, 'files', it('S', 'in', ['files'])],
    ['P10', 'S9', 1770, 'project files', it('S', 'out', ['project files'])],
    ['P10', 'T9', 1870, 'group files', it('T', 'out', ['group files'])],
    ['W9', 'P10', 1965, 'files and\nreviews', it('W', 'in', ['files and reviews'])],
    ['P10', 'W9', 2000, 'project files', it('W', 'out', ['project files'])],
  ]
  bot10.forEach(([a, b, x, label, flow], i) => V(a, b, x, label, { lab: R(x, tiersBot[i % 4]), items: [flow] }))

  return d
}

