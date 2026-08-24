// Drafts a task list for one project.
//
// Runs as an Edge Function because it needs the Anthropic key, which must stay
// server-side. It only ever returns a draft — nothing is written to a board.
// The person who asked for it edits and chooses what to keep, so a bad draft
// costs nothing and the board is never filled behind anyone's back.
//
// Deploy:  supabase functions deploy generate-tasks
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODEL = 'claude-opus-5'

/** The shape the model must return. Structured outputs guarantee it parses. */
const TASK_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          details: { type: 'string' },
          weight: { type: 'integer' },
        },
        required: ['title', 'details', 'weight'],
        additionalProperties: false,
      },
    },
    note: { type: 'string' },
  },
  required: ['tasks', 'note'],
  additionalProperties: false,
} as const

const SYSTEM = `You break a BSIT course project into the tasks a student team has
to carry out. You are given the project as the professor wrote it, the rubric it
will be marked against, and the syllabus weeks it is built on.

Rules:
- Every task must trace back to something in the brief, the rubric, or the weeks
  given. Do not add scope the professor did not ask for, and do not pad the list
  with generic project-management chores.
- Between 4 and 12 tasks. Fewer is fine for a short activity.
- title: what to do, starting with a verb, at most about ten words.
- details: one or two sentences saying what finishing it actually means — the
  condition someone could check it against. No restating the title.
- weight: how big this task is next to the others, 1 to 20. These are relative
  only; the app turns them into a share of 100. Heavier means more work, not
  more importance.
- Order them the way the work has to happen.
- Split the work so it can be handed to different people. Avoid one task that is
  really the whole project.
- If existing tasks are listed, do not repeat them — suggest only what is
  missing.
- note: one short sentence on what you based the list on, or what the brief left
  unclear. Never advice, never encouragement.
- If the brief is too thin to draft anything honest, return an empty list and
  say so in note.`

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

  if (!apiKey) {
    return json({ result: 'failed', message: 'The AI key is not set on the server yet.' })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    // Everything is read through the caller's own JWT, so RLS decides what this
    // person may see. A project id alone proves nothing.
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
    } = await caller.auth.getUser()
    if (!user) return json({ result: 'failed', message: 'Sign in first.' }, 401)

    /**
     * How often this person may ask. Enforced in the database rather than here,
     * so it survives a second copy of this function, a restart, and anybody
     * calling the endpoint directly — an in-memory counter in an edge runtime
     * resets whenever the instance does, which is exactly when it matters.
     *
     * Two windows, because the shapes of misuse differ: a loop hits the hourly
     * one in seconds, while a slow drip that would still run up a bill over a
     * weekend hits the daily one.
     */
    const limited = await caller.rpc('rate_limit', {
      p_bucket: 'ai_generate_tasks_hour',
      p_max: 12,
      p_per: '01:00:00',
      p_message: 'That is twelve drafts in an hour. Take what you have and edit it — the AI is here to start a list, not to write it for you.',
    })
    if (limited.error) {
      return json({ result: 'failed', message: limited.error.message }, 429)
    }

    const limitedDay = await caller.rpc('rate_limit', {
      p_bucket: 'ai_generate_tasks_day',
      p_max: 50,
      p_per: '24:00:00',
      p_message: 'That is fifty drafts today. Come back tomorrow.',
    })
    if (limitedDay.error) {
      return json({ result: 'failed', message: limitedDay.error.message }, 429)
    }

    const body = await req.json().catch(() => ({}))
    const projectId = String(body.project_id ?? '')
    const boardId = body.board_id ? String(body.board_id) : ''
    if (!projectId) return json({ result: 'failed', message: 'No project given.' }, 400)

    const { data: project } = await caller
      .from('project_overview')
      .select(
        'id, title, type, type_label, guidelines, total_points, due_at, audience, start_week, end_week, class_id, week_assessments',
      )
      .eq('id', projectId)
      .maybeSingle()

    if (!project) {
      return json({ result: 'failed', message: 'That project is not available to you.' }, 403)
    }

    const [{ data: criteria }, { data: weeks }] = await Promise.all([
      caller
        .from('project_criteria')
        .select('label, description, max_points')
        .eq('project_id', projectId)
        .order('position'),
      caller
        .from('class_week_map')
        .select('week_no, title, topics, outcomes, assessments')
        .eq('class_id', project.class_id)
        .gte('week_no', project.start_week)
        .lte('week_no', project.end_week)
        .order('week_no'),
    ])

    let existing: { title: string }[] = []
    let teamSize = 0
    if (boardId) {
      const [{ data: tasks }, { data: board }] = await Promise.all([
        caller.from('project_tasks').select('title').eq('board_id', boardId),
        caller
          .from('task_board_overview')
          .select('member_count')
          .eq('id', boardId)
          .maybeSingle(),
      ])
      existing = tasks ?? []
      teamSize = board?.member_count ?? 0
    }

    const brief = [
      `Project: ${project.title}`,
      `Type: ${project.type_label || project.type}`,
      `Done by: ${project.audience === 'group' ? 'a group together' : 'each student alone'}`,
      teamSize > 0 ? `Team size: ${teamSize}` : '',
      `Worth: ${project.total_points} points`,
      project.due_at ? `Due: ${new Date(project.due_at).toDateString()}` : 'No deadline set',
      '',
      'Guidelines from the professor:',
      project.guidelines?.trim() || '(none written)',
      '',
      'Rubric:',
      (criteria ?? []).length > 0
        ? (criteria ?? [])
            .map(
              (c: { label: string; description: string; max_points: number }) =>
                `- ${c.label} (${c.max_points} pts)${c.description ? `: ${c.description}` : ''}`,
            )
            .join('\n')
        : '(none set — mark on the total)',
      '',
      `Syllabus weeks ${project.start_week}–${project.end_week} it is built on:`,
      (weeks ?? [])
        .map(
          (w: {
            week_no: number
            title: string
            topics: string
            outcomes: string
            assessments: string
          }) =>
            [
              `Week ${w.week_no}: ${w.title}`,
              w.topics ? `  Topics: ${w.topics}` : '',
              w.outcomes ? `  Outcomes: ${w.outcomes}` : '',
              w.assessments ? `  Expected: ${w.assessments}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
        )
        .join('\n') || '(no week detail)',
      existing.length > 0
        ? `\nTasks the team already has, do not repeat them:\n${existing
            .map((t) => `- ${t.title}`)
            .join('\n')}`
        : '',
    ]
      .filter((line) => line !== '')
      .join('\n')

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: TASK_SCHEMA },
      },
      messages: [{ role: 'user', content: `Break this project into tasks.\n\n${brief}` }],
    })

    if (message.stop_reason === 'refusal') {
      return json({ result: 'failed', message: 'No draft could be produced for this brief.' })
    }

    const textBlock = message.content.find((b) => b.type === 'text')
    const parsed = JSON.parse(textBlock && 'text' in textBlock ? textBlock.text : '{}')

    const tasks = (parsed.tasks ?? [])
      .filter((t: { title?: string }) => String(t.title ?? '').trim().length > 0)
      .slice(0, 12)
      .map((t: Record<string, unknown>) => ({
        title: String(t.title ?? '').slice(0, 140),
        details: String(t.details ?? '').slice(0, 600),
        weight: Math.max(1, Math.min(20, Number(t.weight) || 1)),
      }))

    return json({
      result: 'ok',
      tasks,
      note: String(parsed.note ?? '').slice(0, 300),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The draft could not be produced.'
    return json({ result: 'failed', message })
  }
})
