#!/usr/bin/env node
// Build the evaluation questionnaire as a Word document.
//
//   node scripts/questionnaire-docx.mjs
//
// The items come from docs/evaluation-questionnaire.html so the Word file and
// the PDF can never drift apart — edit the HTML, run this, and both are right.
//
// Black only, on purpose: this gets photocopied, and a respondent's pen has to
// read against it. Table headers keep a light grey fill so they are still
// distinguishable without colour.

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  PageBreak,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require('docx')

/* ----------------------------------------------------------------- parsing */

const html = readFileSync('docs/evaluation-questionnaire.html', 'utf8')
const unescape = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#10003;/g, '✓')
    .replace(/&#9744;/g, '☐')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const sections = []
const re =
  /<h3>Section (\w) — ([^<]+?)\s*(?:<span class="expert-only">([^<]+)<\/span>)?\s*<\/h3>\s*<p class="indicators">([\s\S]*?)<\/p>\s*<table>([\s\S]*?)<\/table>/g
for (const m of html.matchAll(re)) {
  const [, letter, name, expert, ind, body] = m
  const items = [...body.matchAll(/<td class="no">(\d+)<\/td><td>([\s\S]*?)<\/td>/g)].map((r) => ({
    no: Number(r[1]),
    text: unescape(r[2]),
  }))
  sections.push({
    letter,
    name: name.trim(),
    expertOnly: Boolean(expert),
    indicators: unescape(ind).replace(/^Indicators:\s*/, ''),
    items,
  })
}
if (sections.length !== 9) throw new Error(`expected 9 sections, parsed ${sections.length}`)

/* ------------------------------------------------------------- ingredients */

const BLACK = '000000'
const BAND = 'E8E8E8'

// A4 usable width at the margins below: 21cm - 3cm = 18cm = 10206 DXA.
const FULL = 10206
const TICK = 620
const NO = 560
const STATEMENT = FULL - NO - TICK * 5

const border = { style: BorderStyle.SINGLE, size: 6, color: BLACK }
const ALL_BORDERS = { top: border, bottom: border, left: border, right: border }

const text = (t, o = {}) => new TextRun({ text: t, color: BLACK, ...o })

const p = (t, o = {}) =>
  new Paragraph({
    children: Array.isArray(t) ? t : [text(t, o.run ?? {})],
    spacing: { after: o.after ?? 100, before: o.before ?? 0 },
    alignment: o.alignment,
    heading: o.heading,
    outlineLevel: o.outlineLevel,
    border: o.border,
    indent: o.indent,
    bullet: o.bullet,
  })

/** A black bar with the part name reversed out of it. */
const partBar = (label) =>
  new Table({
    width: { size: FULL, type: WidthType.DXA },
    columnWidths: [FULL],
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: FULL, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: BLACK, color: 'auto' },
            margins: { top: 90, bottom: 90, left: 120, right: 120 },
            children: [
              new Paragraph({
                spacing: { after: 0 },
                children: [new TextRun({ text: label, bold: true, color: 'FFFFFF', size: 23 })],
              }),
            ],
          }),
        ],
      }),
    ],
  })

const heading = (t, level = HeadingLevel.HEADING_2) =>
  new Paragraph({
    heading: level,
    spacing: { before: 220, after: 90 },
    children: [new TextRun({ text: t, bold: true, color: BLACK, size: 21 })],
  })

const cell = (children, width, o = {}) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: ALL_BORDERS,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children,
  })

const line = (t, o = {}) =>
  new Paragraph({
    spacing: { after: 0 },
    alignment: o.alignment,
    children: [new TextRun({ text: t, color: BLACK, bold: o.bold, italics: o.italics, size: o.size ?? 19 })],
  })

/** The rating grid for one characteristic. */
function itemTable(items) {
  const head = new TableRow({
    tableHeader: true,
    children: [
      cell([line('No.', { bold: true, size: 18, alignment: AlignmentType.CENTER })], NO, { shade: BAND }),
      cell([line('Statement', { bold: true, size: 18 })], STATEMENT, { shade: BAND }),
      ...['5', '4', '3', '2', '1'].map((n) =>
        cell([line(n, { bold: true, size: 18, alignment: AlignmentType.CENTER })], TICK, { shade: BAND }),
      ),
    ],
  })

  const rows = items.map(
    (it) =>
      new TableRow({
        cantSplit: true,
        children: [
          cell([line(String(it.no), { alignment: AlignmentType.CENTER })], NO),
          cell([line(it.text)], STATEMENT),
          ...Array.from({ length: 5 }, () => cell([line(' ')], TICK)),
        ],
      }),
  )

  return new Table({
    width: { size: FULL, type: WidthType.DXA },
    columnWidths: [NO, STATEMENT, TICK, TICK, TICK, TICK, TICK],
    rows: [head, ...rows],
  })
}

/** A two-column table: label on the left, space to write on the right. */
function formTable(rows, leftWidth = 3600) {
  const right = FULL - leftWidth
  return new Table({
    width: { size: FULL, type: WidthType.DXA },
    columnWidths: [leftWidth, right],
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          cantSplit: true,
          children: [
            cell([line(label, { bold: true })], leftWidth),
            cell(
              (Array.isArray(value) ? value : [value]).map((v) => line(v)),
              right,
            ),
          ],
        }),
    ),
  })
}

function simpleTable(headers, rows, widths) {
  return new Table({
    width: { size: FULL, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) =>
          cell([line(h, { bold: true, size: 18 })], widths[i], { shade: BAND }),
        ),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            cantSplit: true,
            children: r.map((c, i) => cell([line(c)], widths[i])),
          }),
      ),
    ],
  })
}

const bullets = (lines) =>
  lines.map(
    (t) =>
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 50 },
        children: [new TextRun({ text: t, color: BLACK, size: 19 })],
      }),
  )

const gap = (after = 160) => new Paragraph({ spacing: { after }, children: [] })

/* ------------------------------------------------------------------ document */

const body = []

// --- letterhead
body.push(
  line("Dr. Yanga's Colleges, Inc.  ·  College of Computer Studies", { size: 19 }),
  line('Bachelor of Science in Information Technology  ·  Capstone and Research Project 2', {
    size: 19,
  }),
  new Paragraph({
    spacing: { before: 140, after: 60 },
    children: [new TextRun({ text: 'Software Evaluation Questionnaire', bold: true, color: BLACK, size: 38 })],
  }),
  line('Collabify — A Coursework and Project Management System for the BSIT Program', { size: 21 }),
  new Paragraph({
    spacing: { after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLACK, space: 6 } },
    children: [
      text('Evaluation instrument based on ', { size: 21 }),
      text('ISO/IEC 25010:2023', { size: 21, bold: true }),
      text(' Product Quality Model', { size: 21 }),
    ],
  }),
)

// --- Part I
body.push(partBar('PART I — INSTRUCTIONS'), gap(120))

body.push(heading('Purpose of the Evaluation'))
body.push(
  p(
    "This questionnaire measures the quality of Collabify, a web-based system that lets BSIT professors run their classes' coursework — syllabus weeks, group sets, project boards, task claiming, submission and results — and lets the program office see how the program is progressing. Your answers determine how the system is assessed against the nine quality characteristics of ISO/IEC 25010:2023.",
    { run: { size: 19 }, after: 120 },
  ),
)

body.push(heading('Confidentiality Statement'))
body.push(
  p(
    'All responses are treated as confidential and will be used only for the academic purposes of this capstone research. Individual answers will not be published; only summarised figures (weighted means per characteristic) will appear in the study. Your name is optional and no response will be attributed to you without your consent.',
    { run: { size: 19 }, after: 120 },
  ),
)

body.push(heading('How to Answer'))
body.push(
  ...bullets([
    'Use the system before answering, so that each rating is based on actual use.',
    'Put a check (✓) in the one box that matches your judgement of each statement.',
    'Answer every item. If an item does not apply to your role, write N/A beside it.',
    'Rate only what the statement says — each item covers one idea only.',
    'Comments are welcome at the end of every section and are as useful as the ratings.',
  ]),
  gap(120),
)

body.push(heading('Rating Scale Guide'))
body.push(
  simpleTable(
    ['Scale', 'Verbal Interpretation', 'Meaning'],
    [
      ['5', 'Strongly Agree', 'The system fully meets the statement.'],
      ['4', 'Agree', 'The system meets the statement with minor exceptions.'],
      ['3', 'Neutral', 'The system partly meets the statement.'],
      ['2', 'Disagree', 'The system meets the statement poorly.'],
      ['1', 'Strongly Disagree', 'The system does not meet the statement.'],
    ],
    [1100, 3200, FULL - 1100 - 3200],
  ),
  gap(140),
)

body.push(
  new Table({
    width: { size: FULL, type: WidthType.DXA },
    columnWidths: [FULL],
    rows: [
      new TableRow({
        children: [
          cell(
            [
              new Paragraph({
                spacing: { after: 0 },
                children: [
                  text('Which sections to answer.  ', { bold: true, size: 19 }),
                  text(
                    'All respondents answer Sections A to F. Sections G, H and I ask about the code and deployment of the system, so they are for IT EXPERTS ONLY — IT faculty, software developers and system administrators. End users (students and professors) may leave them blank.',
                    { size: 19 },
                  ),
                ],
              }),
            ],
            FULL,
            { shade: BAND },
          ),
        ],
      }),
    ],
  }),
)

// --- Part II
body.push(new Paragraph({ children: [new PageBreak()] }))
body.push(partBar('PART II — RESPONDENT PROFILE'), gap(120))
body.push(
  formTable([
    ['Name (optional)', ' '],
    ['Position / Designation', ' '],
    ['Organization / Institution', ' '],
    [
      'Years of Experience',
      '☐ Less than 1 year    ☐ 1–3 years    ☐ 4–6 years    ☐ 7–10 years    ☐ More than 10 years',
    ],
    [
      'Area of Expertise',
      [
        '☐ Software Development    ☐ Systems Analysis and Design',
        '☐ Database Administration    ☐ Network / Systems Administration',
        '☐ IT Education / Faculty    ☐ Quality Assurance / Testing',
        '☐ Other: ______________________________',
      ],
    ],
    [
      'Type of Respondent',
      [
        '☐ IT Expert    ☐ Faculty Evaluator    ☐ Industry Expert',
        '☐ System Administrator    ☐ Professor (End User)    ☐ Student (End User)',
      ],
    ],
    ['Date of Evaluation', ' '],
  ]),
)

// --- Part III
body.push(new Paragraph({ children: [new PageBreak()] }))
body.push(partBar('PART III — SOFTWARE EVALUATION'), gap(60))
body.push(
  p('Organized by the nine quality characteristics of ISO/IEC 25010:2023.', {
    run: { size: 19, italics: true },
    after: 160,
  }),
)

for (const s of sections) {
  body.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 60 },
      children: [
        new TextRun({ text: `Section ${s.letter} — ${s.name}`, bold: true, color: BLACK, size: 21 }),
        ...(s.expertOnly
          ? [new TextRun({ text: '     IT EXPERTS ONLY', bold: true, color: BLACK, size: 17 })]
          : []),
      ],
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: `Indicators: ${s.indicators}`, italics: true, color: BLACK, size: 17 }),
      ],
    }),
    itemTable(s.items),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: 'Comments: ______________________________________________________________________',
          color: BLACK,
          size: 19,
        }),
      ],
    }),
  )
}

// --- overall
body.push(heading('Overall Assessment'))
body.push(
  formTable(
    [
      ['What is the greatest strength of the system?', ' '],
      ['What part of the system most needs improvement?', ' '],
      [
        'Would you recommend the system for use in the BSIT program?',
        '☐ Yes    ☐ Yes, with revisions    ☐ No',
      ],
      ['Other recommendations', ' '],
    ],
    4700,
  ),
  gap(400),
)

body.push(
  line('______________________________________          ____________________'),
  line('Signature over Printed Name                                    Date', { size: 17 }),
  gap(200),
  line(
    'Thank you for taking the time to evaluate Collabify. Your assessment forms part of the research findings of this capstone study.',
    { size: 17, italics: true },
  ),
)

// --- researcher page
body.push(new Paragraph({ children: [new PageBreak()] }))
body.push(partBar('FOR THE RESEARCHER — SCORING GUIDE'), gap(120))
body.push(
  p(
    'This page is NOT given to respondents. Remove it before distributing.',
    { run: { size: 19, bold: true }, after: 160 },
  ),
)

body.push(heading('Computing the results'))
body.push(
  ...bullets([
    'Compute the weighted mean of each item.',
    'Compute the mean per characteristic (Sections A to I) by averaging the item means within that section.',
    'Compute the overall mean by averaging the nine characteristic means.',
    'Report Sections G, H and I separately from A to F, since only IT experts answer them — averaging them with end-user responses would misrepresent both.',
  ]),
  gap(120),
)

body.push(heading('Interpretation of the weighted mean'))
body.push(
  simpleTable(
    ['Range', 'Verbal Interpretation', 'Descriptive Meaning'],
    [
      ['4.20 – 5.00', 'Excellent', 'The characteristic is fully satisfied.'],
      ['3.40 – 4.19', 'Very Good', 'The characteristic is satisfied with minor issues.'],
      ['2.60 – 3.39', 'Good', 'The characteristic is partly satisfied.'],
      ['1.80 – 2.59', 'Fair', 'The characteristic is poorly satisfied.'],
      ['1.00 – 1.79', 'Poor', 'The characteristic is not satisfied.'],
    ],
    [1900, 2600, FULL - 1900 - 2600],
  ),
)
body.push(
  p(
    'State the chosen interpretation scale in Chapter 3 of the paper, since more than one is in common use and the reader cannot tell which was applied from the figures alone.',
    { run: { size: 17, italics: true }, after: 160 },
  ),
)

body.push(heading('Before distributing'))
body.push(
  ...bullets([
    'Have this instrument validated by 3–5 experts using a separate validation sheet, and compute the Content Validity Index (I-CVI = experts rating 3 or 4 ÷ total experts).',
    'Revise any item scoring below 0.78 and record the change.',
    'Recommended respondents: 3–5 IT experts, 2–3 faculty evaluators, and 15–30 end users (students and professors who have actually used the system).',
    'Ask respondents to use the system first. A rating given without use measures the demo, not the software.',
  ]),
)

/* -------------------------------------------------------------------- write */

const doc = new Document({
  creator: 'Collabify — Capstone and Research Project 2',
  title: 'Collabify Software Evaluation Questionnaire (ISO/IEC 25010:2023)',
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 20, color: BLACK } },
    },
  },
  sections: [
    {
      properties: {
        page: {
          // A4, and 1.5 cm side margins to fit the seven-column grid.
          margin: { top: 900, right: 850, bottom: 900, left: 850 },
        },
      },
      children: body,
    },
  ],
})

const out = 'docs/Collabify-Evaluation-Questionnaire.docx'
writeFileSync(out, await Packer.toBuffer(doc))
console.log(
  `${out}  ${sections.length} sections, ${sections.reduce((n, s) => n + s.items.length, 0)} items`,
)
