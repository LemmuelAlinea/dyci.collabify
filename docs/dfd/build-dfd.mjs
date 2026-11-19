// Builds the Collabify data flow diagrams (Gane & Sarson notation).
//
//   node docs/dfd/build-dfd.mjs          writes the SVGs and the two-page .drawio
//   node docs/dfd/build-dfd.mjs --png    also renders PNGs with headless Chrome (3x)
//
// Each diagram is data: nodes with a box, edges with a polyline. The same data
// writes the SVG and the draw.io page, so the two never drift apart. The script
// also checks that Level 1 balances Level 0: every item of every Level 0 flow
// appears on Level 1 between the same entity and some process, in the same
// direction, and nothing extra appears.

import { writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { level0, level1 } from './dfd-data.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const FONT = 'Arial'
const INK = '#000000'
const PAPER = '#FFFFFF'
const STROKE = 1.6
const LINE = 1.3

// ---------- text metrics (Arial, em fractions) ----------

const NARROW = new Set([...'ijl.,:;\'|!'])
const THIN = new Set([...'frt()-/ '])
const WIDE = new Set([...'mwMW'])
export function textWidth(s, fs) {
  let w = 0
  for (const ch of s) {
    if (NARROW.has(ch)) w += 0.24
    else if (THIN.has(ch)) w += 0.31
    else if (WIDE.has(ch)) w += 0.83
    else if (ch >= 'A' && ch <= 'Z') w += 0.67
    else if (ch >= '0' && ch <= '9') w += 0.556
    else w += 0.53
  }
  return w * fs
}

export function wrap(text, fs, maxW) {
  const out = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (line && textWidth(next, fs) > maxW) {
        out.push(line)
        line = word
      } else line = next
    }
    out.push(line)
  }
  return out
}

// ---------- geometry ----------

function attach(n, p) {
  // The point on n's border that lines up with p (vertical exit when p sits
  // above or below n, horizontal otherwise).
  if (p[0] >= n.x && p[0] <= n.x + n.w && (p[1] < n.y || p[1] > n.y + n.h)) {
    return [p[0], p[1] < n.y ? n.y : n.y + n.h]
  }
  return [p[0] < n.x ? n.x : n.x + n.w, p[1]]
}

function dropCollinear(pts) {
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [out[out.length - 1], pts[i], pts[i + 1]]
    const same = (a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])
    if (!same) out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

function lengthAlong(pts) {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return L
}

function nearestOnPath(pts, c) {
  let best = { d: Infinity, s: 0, p: pts[0] }
  let s0 = 0
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((c[0] - a[0]) * (b[0] - a[0]) + (c[1] - a[1]) * (b[1] - a[1])) / (len * len)))
    const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
    const d = Math.hypot(c[0] - p[0], c[1] - p[1])
    if (d < best.d) best = { d, s: s0 + t * len, p }
    s0 += len
  }
  return best
}

// ---------- diagram model ----------

export function makeDiagram(name, W, H, sizes) {
  const d = { name, W, H, sizes, nodes: {}, order: [], edges: [] }
  const add = (n) => {
    if (d.nodes[n.id]) throw new Error(`${name}: duplicate node ${n.id}`)
    d.nodes[n.id] = n
    d.order.push(n.id)
    return n
  }
  d.entity = (id, base, label, x, y, w, h) => add({ kind: 'entity', id, base, label, x, y, w, h, dup: false })
  d.process = (id, num, label, x, y, w, h) => add({ kind: 'process', id, num, label, x, y, w, h })
  d.store = (id, sid, label, x, y, w, h) => add({ kind: 'store', id, sid, label, x, y, w, h })
  d.junction = (id, x, y) => add({ kind: 'junction', id, x, y, w: 0, h: 0 })
  // edge(from, to, via, label, opts). via: interior points; the ends are
  // attached to the nodes' borders automatically. opts.arrow=false draws a
  // plain stub (bus pieces). opts.items: [{ent, dir:'in'|'out', items:[...]}]
  // for the balance check. opts.lab: {x, y, anchor} pins the label's anchor.
  d.edge = (from, to, via, label, opts = {}) => {
    const a = d.nodes[from]
    const b = d.nodes[to]
    if (!a || !b) throw new Error(`${name}: edge ${from} -> ${to} names a missing node`)
    const first = a.kind === 'junction' ? [a.x, a.y] : attach(a, via[0])
    const last = b.kind === 'junction' ? [b.x, b.y] : attach(b, via[via.length - 1])
    const pts = dropCollinear([first, ...via, last])
    const e = { from, to, pts, label: label ?? '', arrow: opts.arrow !== false, lab: opts.lab, side: opts.side, items: opts.items ?? [] }
    d.edges.push(e)
    return e
  }
  return d
}

// ---------- label layout (shared by SVG and draw.io) ----------

function layoutLabel(d, e) {
  if (!e.label) return null
  const fs = d.sizes.flow
  const lines = e.label.split('\n')
  const lh = fs * 1.2
  const w = Math.max(...lines.map((l) => textWidth(l, fs)))
  const h = lines.length * lh
  let x, y, anchor
  if (e.lab) {
    ;({ x, y } = e.lab)
    anchor = e.lab.anchor ?? 'middle'
  } else {
    // Longest segment, beside a vertical one, above a horizontal one.
    let best = 0
    let seg = [e.pts[0], e.pts[1]]
    for (let i = 1; i < e.pts.length; i++) {
      const L = Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1])
      if (L > best) {
        best = L
        seg = [e.pts[i - 1], e.pts[i]]
      }
    }
    const mx = (seg[0][0] + seg[1][0]) / 2
    const my = (seg[0][1] + seg[1][1]) / 2
    if (seg[0][0] === seg[1][0]) {
      anchor = e.side === 'l' ? 'end' : 'start'
      x = mx + (anchor === 'end' ? -7 : 7)
      y = my
    } else {
      anchor = 'middle'
      x = mx
      y = e.side === 'b' ? my + h / 2 + 5 : my - h / 2 - 5
    }
  }
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2
  return { lines, fs, lh, w, h, anchor, x, y, box: { x: left - 3, y: y - h / 2 - 1, w: w + 6, h: h + 2 } }
}

// ---------- SVG ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function svgText(lines, cx, cy, fs, anchor = 'middle', weight = 'normal') {
  const lh = fs * 1.2
  const top = cy - (lines.length * lh) / 2 + lh / 2
  return lines
    .map(
      (l, i) =>
        `<text x="${cx.toFixed(1)}" y="${(top + i * lh).toFixed(1)}" font-family="${FONT}" font-size="${fs}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="central" fill="${INK}">${esc(l)}</text>`,
    )
    .join('')
}

export function toSvg(d) {
  const s = d.sizes
  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${d.W}" height="${d.H}" viewBox="0 0 ${d.W} ${d.H}">`,
    `<defs><marker id="ah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="${s.arrow}" markerHeight="${s.arrow}" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${INK}"/></marker></defs>`,
    `<rect width="${d.W}" height="${d.H}" fill="${PAPER}"/>`,
  )
  // Edges first, so boxes sit on top of line ends.
  for (const e of d.edges) {
    const pts = e.pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')
    parts.push(
      `<polyline points="${pts}" fill="none" stroke="${INK}" stroke-width="${LINE}" stroke-linejoin="miter"${e.arrow ? ' marker-end="url(#ah)"' : ''}/>`,
    )
  }
  for (const id of d.order) {
    const n = d.nodes[id]
    const cx = n.x + n.w / 2
    if (n.kind === 'entity') {
      parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="${PAPER}" stroke="${INK}" stroke-width="${STROKE}"/>`)
      if (n.dup) parts.push(`<line x1="${n.x}" y1="${n.y + n.h - 12}" x2="${n.x + 12}" y2="${n.y + n.h}" stroke="${INK}" stroke-width="${STROKE}"/>`)
      parts.push(svgText(wrap(n.label, s.entity, n.w - 14), cx, n.y + n.h / 2, s.entity, 'middle', 'bold'))
    } else if (n.kind === 'process') {
      parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12" fill="${PAPER}" stroke="${INK}" stroke-width="${STROKE}"/>`)
      parts.push(`<line x1="${n.x}" y1="${n.y + s.band}" x2="${n.x + n.w}" y2="${n.y + s.band}" stroke="${INK}" stroke-width="${STROKE}"/>`)
      parts.push(svgText([n.num], cx, n.y + s.band / 2, s.num, 'middle', 'bold'))
      parts.push(svgText(wrap(n.label, s.process, n.w - 20), cx, n.y + s.band + (n.h - s.band) / 2, s.process))
    } else if (n.kind === 'store') {
      const r = n.x + n.w
      const b = n.y + n.h
      parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="${PAPER}" stroke="none"/>`)
      parts.push(`<polyline points="${r},${n.y} ${n.x},${n.y} ${n.x},${b} ${r},${b}" fill="none" stroke="${INK}" stroke-width="${STROKE}"/>`)
      parts.push(`<line x1="${n.x + s.storeId}" y1="${n.y}" x2="${n.x + s.storeId}" y2="${b}" stroke="${INK}" stroke-width="${STROKE}"/>`)
      parts.push(svgText([n.sid], n.x + s.storeId / 2, n.y + n.h / 2, s.store, 'middle', 'bold'))
      parts.push(svgText(wrap(n.label, s.store, n.w - s.storeId - 12), n.x + s.storeId + 7, n.y + n.h / 2, s.store, 'start'))
    }
  }
  // Labels last, on a paper backing so crossing lines never run through words.
  for (const e of d.edges) {
    const L = layoutLabel(d, e)
    if (!L) continue
    parts.push(`<rect x="${L.box.x.toFixed(1)}" y="${L.box.y.toFixed(1)}" width="${L.box.w.toFixed(1)}" height="${L.box.h.toFixed(1)}" fill="${PAPER}"/>`)
    parts.push(svgText(L.lines, L.x, L.y, L.fs, L.anchor))
  }
  parts.push('</svg>')
  return parts.join('\n')
}

// ---------- draw.io ----------

const html = (s) => esc(String(s).split('\n').map(esc).join('<br>'))

function drawioPage(d, pageId) {
  const s = d.sizes
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']
  const base = `html=1;whiteSpace=wrap;fontFamily=${FONT};fontColor=${INK};strokeColor=${INK};fillColor=${PAPER};`
  const cellOf = {}
  for (const id of d.order) {
    const n = d.nodes[id]
    const cid = `${pageId}-${id}`
    if (n.kind === 'entity') {
      cells.push(
        `<mxCell id="${cid}" value="${html(n.label)}" style="rounded=0;${base}strokeWidth=${STROKE};fontSize=${s.entity};fontStyle=1;" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" as="geometry"/></mxCell>`,
      )
      if (n.dup) {
        cells.push(
          `<mxCell id="${cid}-dup" style="endArrow=none;html=1;strokeColor=${INK};strokeWidth=${STROKE};" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${n.x}" y="${n.y + n.h - 12}" as="sourcePoint"/><mxPoint x="${n.x + 12}" y="${n.y + n.h}" as="targetPoint"/></mxGeometry></mxCell>`,
        )
      }
      cellOf[id] = [{ cid, x: n.x, y: n.y, w: n.w, h: n.h }]
    } else if (n.kind === 'process') {
      cells.push(
        `<mxCell id="${cid}" value="${html(n.num)}" style="swimlane;rounded=1;arcSize=10;startSize=${s.band};collapsible=0;${base}swimlaneFillColor=${PAPER};strokeWidth=${STROKE};fontSize=${s.num};fontStyle=1;" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" as="geometry"/></mxCell>`,
        `<mxCell id="${cid}-name" value="${html(n.label)}" style="text;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontFamily=${FONT};fontColor=${INK};fontSize=${s.process};" vertex="1" parent="${cid}"><mxGeometry x="0" y="${s.band}" width="${n.w}" height="${n.h - s.band}" as="geometry"/></mxCell>`,
      )
      cellOf[id] = [{ cid, x: n.x, y: n.y, w: n.w, h: n.h }]
    } else if (n.kind === 'store') {
      cells.push(
        `<mxCell id="${cid}" value="${html(n.sid)}" style="rounded=0;${base}strokeWidth=${STROKE};fontSize=${s.store};fontStyle=1;" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="${s.storeId}" height="${n.h}" as="geometry"/></mxCell>`,
        `<mxCell id="${cid}-name" value="${html(n.label)}" style="shape=partialRectangle;left=0;right=0;top=1;bottom=1;align=left;spacingLeft=7;${base}strokeWidth=${STROKE};fontSize=${s.store};" vertex="1" parent="1"><mxGeometry x="${n.x + s.storeId}" y="${n.y}" width="${n.w - s.storeId}" height="${n.h}" as="geometry"/></mxCell>`,
      )
      cellOf[id] = [
        { cid, x: n.x, y: n.y, w: s.storeId, h: n.h },
        { cid: `${cid}-name`, x: n.x + s.storeId, y: n.y, w: n.w - s.storeId, h: n.h },
      ]
    }
  }
  const pick = (id, p) => {
    const list = cellOf[id]
    if (!list) return null
    return list.find((c) => p[0] >= c.x - 0.5 && p[0] <= c.x + c.w + 0.5) ?? list[list.length - 1]
  }
  const rel = (c, p) => [((p[0] - c.x) / c.w).toFixed(4), ((p[1] - c.y) / c.h).toFixed(4)]
  d.edges.forEach((e, i) => {
    const first = e.pts[0]
    const last = e.pts[e.pts.length - 1]
    const src = pick(e.from, first)
    const tgt = pick(e.to, last)
    let style = `edgeStyle=none;rounded=0;html=1;jettySize=auto;strokeColor=${INK};strokeWidth=${LINE};fontFamily=${FONT};fontColor=${INK};fontSize=${s.flow};labelBackgroundColor=${PAPER};endArrow=${e.arrow ? 'block' : 'none'};endFill=1;endSize=7;startArrow=none;`
    if (src) {
      const [x, y] = rel(src, first)
      style += `exitX=${x};exitY=${y};exitDx=0;exitDy=0;exitPerimeter=0;`
    }
    if (tgt) {
      const [x, y] = rel(tgt, last)
      style += `entryX=${x};entryY=${y};entryDx=0;entryDy=0;entryPerimeter=0;`
    }
    const L = layoutLabel(d, e)
    let geomAttrs = 'relative="1"'
    let offset = ''
    if (L) {
      const c = [L.box.x + L.box.w / 2, L.box.y + L.box.h / 2]
      const near = nearestOnPath(e.pts, c)
      const total = lengthAlong(e.pts)
      geomAttrs = `x="${((2 * near.s) / total - 1).toFixed(4)}" relative="1"`
      offset = `<mxPoint x="${(c[0] - near.p[0]).toFixed(1)}" y="${(c[1] - near.p[1]).toFixed(1)}" as="offset"/>`
    }
    const inner = e.pts
      .slice(1, -1)
      .map((p) => `<mxPoint x="${p[0]}" y="${p[1]}"/>`)
      .join('')
    const ends = `${src ? '' : `<mxPoint x="${first[0]}" y="${first[1]}" as="sourcePoint"/>`}${tgt ? '' : `<mxPoint x="${last[0]}" y="${last[1]}" as="targetPoint"/>`}`
    cells.push(
      `<mxCell id="${pageId}-e${i}" value="${html(e.label)}" style="${style}" edge="1" parent="1"${src ? ` source="${src.cid}"` : ''}${tgt ? ` target="${tgt.cid}"` : ''}><mxGeometry ${geomAttrs} as="geometry">${ends}${inner ? `<Array as="points">${inner}</Array>` : ''}${offset}</mxGeometry></mxCell>`,
    )
  })
  return `<diagram id="${pageId}" name="${esc(d.name)}"><mxGraphModel dx="${d.W}" dy="${d.H}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${d.W}" pageHeight="${d.H}" background="${PAPER}" math="0" shadow="0"><root>${cells.join('')}</root></mxGraphModel></diagram>`
}

// ---------- balance check ----------

function flowsOf(d) {
  // Map "entity|dir" -> Set(items), from edges that carry items.
  const m = new Map()
  for (const e of d.edges) {
    for (const f of e.items) {
      const key = `${f.ent}|${f.dir}`
      if (!m.has(key)) m.set(key, new Set())
      for (const it of f.items) {
        if (m.get(key).has(it)) throw new Error(`${d.name}: "${it}" (${key}) appears twice`)
        m.get(key).add(it)
      }
    }
  }
  return m
}

function checkBalance(l0, l1) {
  const a = flowsOf(l0)
  const b = flowsOf(l1)
  const problems = []
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key) ?? new Set()
    const y = b.get(key) ?? new Set()
    for (const it of x) if (!y.has(it)) problems.push(`missing on Level 1: ${key} "${it}"`)
    for (const it of y) if (!x.has(it)) problems.push(`not on Level 0: ${key} "${it}"`)
  }
  if (problems.length) throw new Error(`Levels do not balance:\n  ${problems.join('\n  ')}`)
  let n = 0
  for (const v of a.values()) n += v.size
  return n
}

// ---------- overlap check ----------

function checkLabels(d) {
  // Every label box must stay clear of every node and every other label.
  const boxes = d.edges.map((e) => layoutLabel(d, e)?.box).filter(Boolean)
  const hit = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h
  const problems = []
  boxes.forEach((b, i) => {
    const lab = d.edges.filter((e) => e.label)[i].label.replace(/\n/g, ' ')
    if (b.x < 0 || b.y < 0 || b.x + b.w > d.W || b.y + b.h > d.H) problems.push(`"${lab}" runs off the page`)
    for (const id of d.order) {
      const n = d.nodes[id]
      if (n.kind !== 'junction' && hit(b, n)) problems.push(`"${lab}" covers ${id}`)
    }
    boxes.forEach((c, j) => {
      if (j > i && hit(b, c)) problems.push(`"${lab}" overlaps "${d.edges.filter((e) => e.label)[j].label.replace(/\n/g, ' ')}"`)
    })
  })
  return problems
}

// ---------- duplicates ----------

function markDuplicates(d) {
  // Gane & Sarson: an entity drawn more than once gets the corner stroke on every copy.
  const count = {}
  for (const id of d.order) if (d.nodes[id].kind === 'entity') count[d.nodes[id].base] = (count[d.nodes[id].base] ?? 0) + 1
  for (const id of d.order) if (d.nodes[id].kind === 'entity') d.nodes[id].dup = count[d.nodes[id].base] > 1
  return d
}

// ---------- main ----------

const helpers = { wrap, textWidth }
const l0 = markDuplicates(level0(makeDiagram, helpers))
const l1 = markDuplicates(level1(makeDiagram, helpers))
let items = 0
try {
  items = checkBalance(l0, l1)
} catch (err) {
  if (!process.argv.includes('--draft')) throw err
  console.warn(err.message)
}

let warnings = 0
for (const d of [l0, l1]) {
  for (const p of checkLabels(d)) {
    console.warn(`${d.name}: ${p}`)
    warnings++
  }
}

const files = [
  ['collabify-dfd-level0', l0],
  ['collabify-dfd-level1', l1],
]
for (const [base, d] of files) writeFileSync(join(here, `${base}.svg`), toSvg(d))
writeFileSync(
  join(here, 'collabify-dfd.drawio'),
  `<mxfile host="Collabify DFD build" type="device">${drawioPage(l0, 'level0')}${drawioPage(l1, 'level1')}</mxfile>\n`,
)

if (process.argv.includes('--png')) {
  const chrome = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => p && existsSync(p))
  if (!chrome) throw new Error('No Chrome or Edge found; set CHROME to its path.')
  for (const [base, d] of files) {
    execFileSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=3',
      `--window-size=${d.W},${d.H}`,
      `--screenshot=${join(here, `${base}.png`)}`,
      pathToFileURL(join(here, `${base}.svg`)).href,
    ], { stdio: 'ignore' })
  }
}

console.log(`Balanced: ${items} Level 0 items all appear on Level 1.`)
console.log(`Label warnings: ${warnings}`)
