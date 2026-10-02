// AI helpers for work projects, one function with an action each.
//
//   tasks            notes or a project file -> draft tasks
//   describe         the caller's draft -> a commit message and change title
//   summarize-change a change waiting for review -> what it does, per file
//   summarize-file   one file in Main -> its key points
//   formula          a description of a sum -> an Excel formula
//   ask              a question -> an answer from the project's files
//
// Same rules as the education functions: the key stays server-side, every read
// goes through the caller's JWT so RLS decides what they may see, and nothing
// is written. Each action returns a draft or an answer for a person to use.
//
// Deploy:  supabase functions deploy work-ai
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from 'npm:unpdf'
import { strFromU8, unzipSync } from 'npm:fflate'
import { encodeBase64 } from 'jsr:@std/encoding/base64'
import { cors, corsMode, denied } from '../_shared/cors.ts'

const MODEL = 'claude-opus-5'
const BUCKET = 'general-files'

type Json = Record<string, unknown>
type Effort = 'low' | 'medium' | 'high'

function json(headers: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

class Refused extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

/* ----------------------------------------------------------------- text */

/** A document's HTML as plain text, keeping paragraphs, list items and rows apart. */
function htmlToText(html: string) {
  return html
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A stored workbook as tab-separated text, one block per sheet. */
function sheetToText(content: string) {
  try {
    const wb = JSON.parse(content) as { sheets?: { name: string; rows: string[][] }[] }
    return (wb.sheets ?? [])
      .map((s) => `[Sheet: ${s.name}]\n${(s.rows ?? []).map((r) => r.join('\t')).join('\n')}`)
      .join('\n\n')
  } catch {
    return ''
  }
}

type FileRow = { path: string; kind: string; content: string; storage_path: string | null }

/** Same rule as lib/general/files.ts: the extension decides how a file is held. */
function kindOf(path: string) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (['docx', 'doc', 'odt', 'rtf'].includes(ext)) return 'rich'
  if (['xlsx', 'xlsm', 'csv'].includes(ext)) return 'sheet'
  return 'text'
}

function fileText(f: FileRow) {
  if (f.kind === 'rich') return htmlToText(f.content)
  if (f.kind === 'sheet') return sheetToText(f.content)
  if (f.kind === 'text') return f.content
  return ''
}

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[…cut at ${n} characters]` : s)

async function pdfText(caller: SupabaseClient, storagePath: string) {
  const { data, error } = await caller.storage.from(BUCKET).download(storagePath)
  if (error || !data) throw new Refused('That file could not be read.')
  const pdf = await getDocumentProxy(new Uint8Array(await data.arrayBuffer()))
  const { text } = await extractText(pdf, { mergePages: true })
  return String(text ?? '')
}

/* ------------------------------------------------------------ the model */

async function ask(
  anthropic: Anthropic,
  system: string,
  user: string | Anthropic.ContentBlockParam[],
  schema: Json,
  effort: Effort,
  maxTokens = 8000,
) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: user }],
  })
  if (message.stop_reason === 'refusal') throw new Refused('No answer could be produced for that.')
  const block = message.content.find((b) => b.type === 'text')
  return JSON.parse(block && 'text' in block ? block.text : '{}') as Json
}

const obj = (properties: Json, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const str = { type: 'string' }

const VOICE = `Write in plain, direct English (or Filipino if the source is in
Filipino). Sentence case. No exclamation marks, no "please", no filler, no
praise.`

/* ------------------------------------------------ discussion files */

const DISCUSSION_FILES = 'discussion-files'
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const TEXT_EXT = ['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'yml', 'yaml', 'log', 'sql', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'css']

type SharedFile = { id: string; name: string; path: string; mime: string | null; size: number }

/** A Word file's text, from its document.xml. */
function docxText(bytes: Uint8Array) {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })
  const xml = files['word/document.xml']
  if (!xml) return ''
  return htmlToText(
    strFromU8(xml)
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<\/w:p>/g, '</p>'),
  )
}

/**
 * The files shared in a discussion, as content the model can read: text for
 * documents, the PDF itself, the picture itself. Each is labelled with a short
 * id (f1, f2…) so the model can say which belong to which task. Anything it
 * cannot read is still listed by name.
 */
async function sharedFileBlocks(ctx: Ctx, discussionId: string) {
  // Through the caller's token: only files they may see.
  const { data } = await ctx.caller
    .from('general_discussion_files')
    .select('id, file_name, file_path, mime_type, size_bytes')
    .eq('discussion_id', discussionId)
    .order('created_at')
    .limit(20)
  const rows = (data ?? []) as { id: string; file_name: string; file_path: string; mime_type: string | null; size_bytes: number }[]
  const files: SharedFile[] = rows.map((r) => ({ id: r.id, name: r.file_name, path: r.file_path, mime: r.mime_type, size: r.size_bytes }))
  const blocks: Anthropic.ContentBlockParam[] = []
  const short = new Map<string, string>()
  let bytesLeft = 24 * 1024 * 1024
  let textLeft = 60000

  for (const [i, file] of files.entries()) {
    const label = `f${i + 1}`
    short.set(label, file.id)
    const head = `=== Shared file ${label}: ${file.name} ===`
    const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
    const mime = (file.mime ?? '').toLowerCase()
    const tooBig = file.size > bytesLeft
    const readable =
      mime === 'application/pdf' || ext === 'pdf' || IMAGE_TYPES.includes(mime) || ext === 'docx' ||
      mime.startsWith('text/') || TEXT_EXT.includes(ext)
    if (!readable || tooBig) {
      blocks.push({ type: 'text', text: `${head}\n(${tooBig ? 'too large to read here' : 'not a kind that can be read'}; known by its name only)` })
      continue
    }
    const { data: blob } = await ctx.caller.storage.from(DISCUSSION_FILES).download(file.path)
    if (!blob) {
      blocks.push({ type: 'text', text: `${head}\n(could not be opened; known by its name only)` })
      continue
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    try {
      if (mime === 'application/pdf' || ext === 'pdf') {
        bytesLeft -= bytes.length
        blocks.push({ type: 'text', text: head })
        blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: encodeBase64(bytes) } })
      } else if (IMAGE_TYPES.includes(mime)) {
        if (bytes.length > 4.5 * 1024 * 1024) {
          blocks.push({ type: 'text', text: `${head}\n(a picture too large to look at here; known by its name only)` })
          continue
        }
        bytesLeft -= bytes.length
        blocks.push({ type: 'text', text: head })
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: encodeBase64(bytes) },
        })
      } else {
        const text = ext === 'docx' ? docxText(bytes) : new TextDecoder().decode(bytes)
        const each = Math.max(0, Math.min(15000, textLeft))
        textLeft -= Math.min(text.length, each)
        blocks.push({ type: 'text', text: `${head}\n${each > 0 ? cap(text, each) : '(no room left to include its text)'}` })
      }
    } catch {
      blocks.push({ type: 'text', text: `${head}\n(could not be read; known by its name only)` })
    }
  }
  return { files, blocks, short }
}

/** The text alone, or the text followed by the shared files. */
function withFiles(text: string, blocks: Anthropic.ContentBlockParam[]) {
  if (blocks.length === 0) return text
  return [{ type: 'text' as const, text: `${text}\n\nFiles shared in the discussion follow.` }, ...blocks]
}

/* -------------------------------------------------------------- actions */

type Ctx = { caller: SupabaseClient; anthropic: Anthropic; userId: string; projectId: string; body: Json }

async function mainFiles(ctx: Ctx) {
  const { data, error } = await ctx.caller
    .from('general_repo_tree')
    .select('path, kind, content, storage_path')
    .eq('project_id', ctx.projectId)
    .order('path')
  if (error) throw new Refused('The project files could not be read.')
  return ((data ?? []) as FileRow[]).filter((f) => !f.path.endsWith('/.keep') && f.path !== '.keep')
}

async function tasksAction(ctx: Ctx) {
  // Anyone on a project may add tasks, so anyone may draft them. Putting
  // somebody else on one is still checked when the task is saved.
  let source = String(ctx.body.text ?? '').trim()
  const discussionId = String(ctx.body.discussion_id ?? '')
  let shared: Awaited<ReturnType<typeof sharedFileBlocks>> = { files: [], blocks: [], short: new Map() }
  if (discussionId) {
    // Read through the caller's token, so only a discussion they may see comes back.
    const { data: discussion } = await ctx.caller
      .from('general_discussions')
      .select('content_html, ended_at')
      .eq('id', discussionId)
      .eq('project_id', ctx.projectId)
      .maybeSingle()
    if (!discussion) throw new Refused('That discussion is not in this project.')
    if (!discussion.ended_at) throw new Refused('That discussion is still running. Stop it first, then draft tasks from its file.')
    source = htmlToText(String(discussion.content_html ?? '')).trim()
    shared = await sharedFileBlocks(ctx, discussionId)
  }
  if (source.length < 20) throw new Refused('Give it a little more to read: paste the notes, or pick a discussion.')

  const [{ data: project }, { data: members }, { data: teams }] = await Promise.all([
    ctx.caller.from('general_projects').select('name, starts_on, ends_on').eq('id', ctx.projectId).maybeSingle(),
    ctx.caller
      .from('general_members')
      .select('user_id, profile:profiles (first_name, last_name)')
      .eq('project_id', ctx.projectId),
    ctx.caller.from('general_teams').select('name').eq('project_id', ctx.projectId),
  ])
  type M = { user_id: string; profile: { first_name: string; last_name: string } | null }
  const people = ((members ?? []) as unknown as M[]).map((m) => ({
    id: m.user_id,
    name: m.profile ? `${m.profile.first_name} ${m.profile.last_name}`.trim() : 'Member',
  }))
  const teamNames = ((teams ?? []) as { name: string }[]).map((t) => t.name)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

  const out = await ask(
    ctx.anthropic,
    `You turn meeting notes, minutes or a project document into the action
items a team has to do. Only items the text actually commits someone to: not
discussion, not background, not things already done.
- title: what to do, starting with a verb, at most about ten words.
- description: one or two sentences with the detail the text gives. Empty if
  there is none.
- assignee: the id of the member the text names for it, matched by name, else
  empty. Never guess from roles alone.
- team: one of the team names given if the text puts it there, else empty.
- due: YYYY-MM-DD if the text gives or clearly implies a date (resolve "Friday"
  against today), else empty. Never invent one.
- At most 25 items, in the order the text gives them.
- files: shared files (f1, f2…) are reference material people sent during the
  discussion. Read them for detail that sharpens a task: requirements, names,
  dates, steps. Never make a task only because a file was shared, and never a
  task like "review the file" unless the discussion asks someone to do that.
  List a file on a task when the discussion ties that file to that task: it
  is the task's template, input, instrument or brief, someone is told to use
  it for the task, or the work is done in it. Give its short id exactly as
  labelled, e.g. ["f1"]. Otherwise an empty list.
- note: one short sentence on what you read, or what was unclear.
${VOICE}`,
    withFiles(
      [
        `Today: ${today}`,
        `Project: ${project?.name ?? ''}${project?.starts_on ? `, runs ${project.starts_on} to ${project.ends_on ?? 'open'}` : ''}`,
        `Members (id: name):\n${people.map((p) => `${p.id}: ${p.name}`).join('\n')}`,
        teamNames.length ? `Teams: ${teamNames.join(', ')}` : 'Teams: none',
        '',
        'Text:',
        cap(source, 60000),
      ].join('\n'),
      shared.blocks,
    ),
    obj({
      tasks: {
        type: 'array',
        items: obj({
          title: str,
          description: str,
          assignee: str,
          team: str,
          due: str,
          // Only labels that exist can come back.
          files: { type: 'array', items: shared.short.size > 0 ? { type: 'string', enum: [...shared.short.keys()] } : str },
        }),
      },
      note: str,
    }),
    'medium',
  )

  const ids = new Set(people.map((p) => p.id))
  // The model is asked for "f1", but takes liberties: "F1", "file f1", the
  // file's name, its real id. Any of those finds the file.
  const sharedId = (x: unknown) => {
    const v = String(x ?? '').trim()
    const label = /\bf(\d+)\b/i.exec(v)
    if (label) return shared.short.get(`f${label[1]}`)
    const lower = v.toLowerCase()
    return shared.files.find((f) => f.id === v || f.name.toLowerCase() === lower || (lower && lower.includes(f.name.toLowerCase())))?.id
  }
  console.log('[tasks] shared', shared.files.length, 'linked', JSON.stringify(((out.tasks as Json[]) ?? []).map((t) => t.files)))
  const tasks = ((out.tasks as Json[]) ?? [])
    .filter((t) => String(t.title ?? '').trim())
    .slice(0, 25)
    .map((t) => ({
      title: String(t.title).slice(0, 200),
      description: String(t.description ?? '').slice(0, 2000),
      assignee: ids.has(String(t.assignee)) ? String(t.assignee) : '',
      team: teamNames.includes(String(t.team)) ? String(t.team) : '',
      due: /^\d{4}-\d{2}-\d{2}$/.test(String(t.due)) ? String(t.due) : '',
      files: [...new Set(((t.files as unknown[]) ?? []).map(sharedId).filter((x): x is string => Boolean(x)))],
    }))
  return { tasks, note: String(out.note ?? '').slice(0, 300), shared: shared.files }
}

/** Old and new text per path, for describing a change. */
function beforeAfter(files: { path: string; action: string; after: string }[], main: FileRow[]) {
  const byPath = new Map(main.map((f) => [f.path, f]))
  let budget = 80000
  return files
    .filter((f) => !f.path.endsWith('.keep'))
    .map((f) => {
      const old = byPath.get(f.path)
      const before = old ? fileText(old) : ''
      const each = Math.max(1000, Math.min(12000, Math.floor(budget / 2)))
      budget -= each
      return [
        `=== ${f.path} (${f.action}) ===`,
        f.action === 'added' ? '' : `--- before ---\n${cap(before, each)}`,
        f.action === 'removed' ? '' : `--- after ---\n${cap(f.after, each)}`,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}

async function describeAction(ctx: Ctx) {
  // The editor commits what is on screen, which is not in the draft yet: it
  // sends that text itself. It is the caller's own writing, so nothing is
  // exposed by trusting it.
  if (Array.isArray(ctx.body.files) && ctx.body.files.length > 0) {
    const given = (ctx.body.files as Json[]).slice(0, 20).map((f) => ({
      path: String(f.path ?? ''),
      action: 'modified',
      after: cap(
        fileText({ path: String(f.path ?? ''), kind: String(f.kind ?? kindOf(String(f.path ?? ''))), content: String(f.content ?? ''), storage_path: null }),
        20000,
      ),
    }))
    return describeFiles(ctx, given)
  }
  const { data: draft } = await ctx.caller
    .from('general_drafts')
    .select('id')
    .eq('project_id', ctx.projectId)
    .eq('user_id', ctx.userId)
    .maybeSingle()
  if (!draft) throw new Refused('You have nothing in your draft.')
  const only = Array.isArray(ctx.body.paths) ? new Set((ctx.body.paths as string[]).map(String)) : null
  const { data: rows } = await ctx.caller
    .from('general_draft_files')
    .select('path, action, kind, content, storage_path')
    .eq('draft_id', draft.id)
    .is('archived_at', null)
  const files = ((rows ?? []) as (FileRow & { action: string })[])
    .filter((f) => !only || [...only].some((p) => f.path === p || f.path.startsWith(`${p}/`)))
    .map((f) => ({ path: f.path, action: f.action, after: fileText(f) }))
  if (files.length === 0) throw new Refused('You have nothing in your draft.')
  return describeFiles(ctx, files)
}

async function describeFiles(ctx: Ctx, files: { path: string; action: string; after: string }[]) {
  const out = await ask(
    ctx.anthropic,
    `You write the message for a change to a project's shared files, from the
files before and after. Say what changed and why it matters to the reader, not
how the text was edited.
- title: at most 10 words, sentence case, no trailing period.
- message: one to three sentences. Name the files or sections touched.
${VOICE}`,
    beforeAfter(files, await mainFiles(ctx)),
    obj({ title: str, message: str }),
    'low',
    2000,
  )
  return { title: String(out.title ?? '').slice(0, 120), message: String(out.message ?? '').slice(0, 1000) }
}

async function summarizeChangeAction(ctx: Ctx) {
  const { data: change } = await ctx.caller
    .from('general_repo_changes')
    .select('project_id, title, body, files')
    .eq('id', String(ctx.body.change_id ?? ''))
    .maybeSingle()
  if (!change || change.project_id !== ctx.projectId) throw new Refused('That change is not available to you.', 403)
  const files = ((change.files as { path: string; action: string; content?: string; kind?: string }[]) ?? []).map(
    (f) => ({
      path: f.path,
      action: f.action,
      after: fileText({ path: f.path, kind: f.kind ?? kindOf(f.path), content: f.content ?? '', storage_path: null }),
    }),
  )
  const out = await ask(
    ctx.anthropic,
    `You help someone review a proposed change to a project's shared files. From
the files before and after, say plainly what the change does.
- overall: one or two sentences on the change as a whole.
- files: one entry per file, summary of at most two sentences on what changed
  in it: sections added or removed, figures changed, wording that changes the
  meaning. Point out anything a reviewer should look at twice. Do not judge
  quality and do not recommend accepting or rejecting.
${VOICE}`,
    `Change title: ${change.title}\nAuthor's note: ${change.body || '(none)'}\n\n${beforeAfter(files, await mainFiles(ctx))}`,
    obj({ overall: str, files: { type: 'array', items: obj({ path: str, summary: str }) } }),
    'medium',
    4000,
  )
  const paths = new Set(files.map((f) => f.path))
  return {
    overall: String(out.overall ?? '').slice(0, 600),
    files: ((out.files as Json[]) ?? [])
      .filter((f) => paths.has(String(f.path)))
      .map((f) => ({ path: String(f.path), summary: String(f.summary ?? '').slice(0, 500) })),
  }
}

async function summarizeFileAction(ctx: Ctx) {
  const path = String(ctx.body.path ?? '')
  const file = (await mainFiles(ctx)).find((f) => f.path === path)
  if (!file) throw new Refused('That file is not in Main.')
  const text =
    file.kind === 'binary'
      ? file.storage_path && path.toLowerCase().endsWith('.pdf')
        ? await pdfText(ctx.caller, file.storage_path)
        : ''
      : fileText(file)
  if (text.trim().length < 40) throw new Refused('There is not enough text in that file to summarize.')
  const out = await ask(
    ctx.anthropic,
    `You summarize one file from a school or office project for a busy member.
- points: 3 to 7 key points, each one sentence, in the order the file makes
  them. Keep names, figures and dates exact. Nothing the file does not say.
${VOICE}`,
    `File: ${path}\n\n${cap(text, 150000)}`,
    obj({ points: { type: 'array', items: str } }),
    'medium',
    3000,
  )
  return { points: ((out.points as string[]) ?? []).slice(0, 7).map((p) => String(p).slice(0, 400)) }
}

async function formulaAction(ctx: Ctx) {
  const want = String(ctx.body.description ?? '').trim().slice(0, 500)
  if (want.length < 4) throw new Refused('Say what the formula should work out.')
  const headers = (Array.isArray(ctx.body.headers) ? ctx.body.headers : []).slice(0, 40).map(String)
  const sample = (Array.isArray(ctx.body.sample) ? ctx.body.sample : [])
    .slice(0, 8)
    .map((r) => (Array.isArray(r) ? r.slice(0, 40).map(String) : []))
  const out = await ask(
    ctx.anthropic,
    `You write one Excel formula for a spreadsheet, from a description and the
sheet's first rows. Row 1 holds the headers; columns are lettered A, B, C.
- formula: starts with "=", uses only functions Excel and Google Sheets both
  have, and references real columns from the rows given.
- explanation: one sentence on what it does, naming the columns.
If it cannot be done with the columns given, return an empty formula and say
why in explanation.
${VOICE}`,
    [
      ctx.body.cell ? `The formula goes in cell ${String(ctx.body.cell).slice(0, 10)}.` : '',
      `Row 1: ${headers.map((h, i) => `${String.fromCharCode(65 + (i % 26))}=${h}`).join(', ')}`,
      sample.length ? `Next rows:\n${sample.map((r) => r.join(' | ')).join('\n')}` : '',
      `Wanted: ${want}`,
    ]
      .filter(Boolean)
      .join('\n'),
    obj({ formula: str, explanation: str }),
    'low',
    1500,
  )
  const formula = String(out.formula ?? '').trim()
  return {
    formula: formula && !formula.startsWith('=') ? `=${formula}` : formula.slice(0, 1000),
    explanation: String(out.explanation ?? '').slice(0, 400),
  }
}

async function askAction(ctx: Ctx) {
  const question = String(ctx.body.question ?? '').trim().slice(0, 500)
  if (question.length < 4) throw new Refused('Ask a question about the files.')
  const files = (await mainFiles(ctx)).filter((f) => f.kind !== 'binary')
  if (files.length === 0) throw new Refused('There are no documents, sheets or text files in Main to read yet.')
  let budget = 250000
  const parts: string[] = []
  let left = 0
  for (const f of files) {
    const text = fileText(f)
    if (!text.trim()) continue
    if (budget <= 0) {
      left++
      continue
    }
    const piece = cap(text, Math.min(budget, 60000))
    budget -= piece.length
    parts.push(`=== ${f.path} ===\n${piece}`)
  }
  const out = await ask(
    ctx.anthropic,
    `You answer questions about a project using only its files, given below
with their paths. If the files do not answer it, say so plainly and set found
to false: never fill the gap from general knowledge.
- answer: two to five sentences. Quote short phrases where exact wording
  matters.
- sources: the paths of the files the answer came from.
${VOICE}`,
    `${parts.join('\n\n')}${left ? `\n\n(${left} more files were not read: too much text.)` : ''}\n\nQuestion: ${question}`,
    obj({ answer: str, found: { type: 'boolean' }, sources: { type: 'array', items: str } }),
    'medium',
    3000,
  )
  const known = new Set(files.map((f) => f.path))
  return {
    answer: String(out.answer ?? '').slice(0, 2000),
    found: Boolean(out.found),
    sources: ((out.sources as string[]) ?? []).map(String).filter((p) => known.has(p)).slice(0, 8),
    skipped: left,
  }
}

const ACTIONS: Record<string, { run: (ctx: Ctx) => Promise<unknown>; hour: number; day: number }> = {
  tasks: { run: tasksAction, hour: 12, day: 50 },
  describe: { run: describeAction, hour: 30, day: 150 },
  'summarize-change': { run: summarizeChangeAction, hour: 30, day: 150 },
  'summarize-file': { run: summarizeFileAction, hour: 20, day: 80 },
  formula: { run: formulaAction, hour: 30, day: 150 },
  ask: { run: askAction, hour: 15, day: 60 },
}

console.log(`[cors] ${corsMode()}`)

Deno.serve(async (req) => {
  const { headers: CORS, allowed } = cors(req)
  if (!allowed) return denied(CORS)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(CORS, { result: 'failed', message: 'The AI key is not set on the server yet.' })

  try {
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const {
      data: { user },
    } = await caller.auth.getUser()
    if (!user) return json(CORS, { result: 'failed', message: 'Sign in first.' }, 401)

    const body = (await req.json().catch(() => ({}))) as Json
    const name = String(body.action ?? '')
    const action = ACTIONS[name]
    if (!action) return json(CORS, { result: 'failed', message: 'Unknown helper.' }, 400)
    const projectId = String(body.project_id ?? '')
    const { data: member } = await caller.rpc('is_general_member', { p_project: projectId })
    if (!projectId || !member) {
      return json(CORS, { result: 'failed', message: 'You are not on this project.' }, 403)
    }

    const bucket = `ai_work_${name.replace('-', '_')}`
    for (const [suffix, max, per, message] of [
      ['hour', action.hour, '01:00:00', `That is ${action.hour} in an hour. Try again later.`],
      ['day', action.day, '24:00:00', `That is ${action.day} today. Come back tomorrow.`],
    ] as const) {
      const limited = await caller.rpc('rate_limit', {
        p_bucket: `${bucket}_${suffix}`,
        p_max: max,
        p_per: per,
        p_message: message,
      })
      if (limited.error) return json(CORS, { result: 'failed', message: limited.error.message }, 429)
    }

    const result = await action.run({
      caller,
      anthropic: new Anthropic({ apiKey }),
      userId: user.id,
      projectId,
      body,
    })
    return json(CORS, { result: 'ok', ...(result as Json) })
  } catch (err) {
    if (err instanceof Refused) return json(CORS, { result: 'failed', message: err.message }, err.status)
    const message = err instanceof Error ? err.message : 'That did not work. Try again.'
    return json(CORS, { result: 'failed', message })
  }
})
