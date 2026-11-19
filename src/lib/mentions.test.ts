import { describe, expect, it } from 'vitest'
import {
  decodeForEdit,
  encodeMentions,
  linkToMention,
  mentionCode,
  mentionQueryAt,
  mentionRefs,
  parseMentions,
  previewText,
} from './mentions'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const ORIGIN = 'https://dyci-collabify.vercel.app'

describe('parseMentions', () => {
  it('parseMentions splits text and codes', () => {
    expect(parseMentions(`see #[t:${A}] and #[cp:${B}].`)).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'mention', ref: { kind: 't', id: A } },
      { type: 'text', text: ' and ' },
      { type: 'mention', ref: { kind: 'cp', id: B } },
      { type: 'text', text: '.' },
    ])
  })

  it('parseMentions leaves a malformed code as text', () => {
    expect(parseMentions('#[t:nope] #[x:' + A + ']')).toEqual([{ type: 'text', text: '#[t:nope] #[x:' + A + ']' }])
  })

  it('parseMentions caps at 10', () => {
    const body = Array.from({ length: 11 }, () => mentionCode({ kind: 'p', id: A })).join(' ')
    const segs = parseMentions(body)
    expect(segs.filter((s) => s.type === 'mention')).toHaveLength(10)
    expect(segs[segs.length - 1]).toEqual({ type: 'text', text: ` #[p:${A}]` })
  })

  it('mentionRefs lists each ref once, in order', () => {
    expect(mentionRefs(`#[t:${A}] #[p:${B}] #[t:${A}]`)).toEqual([
      { kind: 't', id: A },
      { kind: 'p', id: B },
    ])
  })
})

describe('previewText', () => {
  it('previewText names the kind', () => {
    expect(previewText(`look at #[ct:${A}] in #[cp:${B}]`)).toBe('look at #task in #project')
    expect(previewText(`#[co:${A}] #[t:${A}] #[p:${A}]`)).toBe('#task #task #project')
  })
})

describe('linkToMention', () => {
  it('linkToMention reads each link shape', () => {
    expect(linkToMention(`${ORIGIN}/projects/${A}?task=${B}`, ORIGIN)).toEqual({ kind: 't', id: B })
    expect(linkToMention(`${ORIGIN}/projects/${A}`, ORIGIN)).toEqual({ kind: 'p', id: A })
    expect(linkToMention(`${ORIGIN}/class-projects/${A}?task=${B}`, ORIGIN)).toEqual({ kind: 'ct', id: B })
    expect(linkToMention(`${ORIGIN}/class-projects/${A}`, ORIGIN)).toEqual({ kind: 'cp', id: A })
    expect(linkToMention(`${ORIGIN}/projects/${A}?tab=files`, ORIGIN)).toBeNull()
  })

  it('linkToMention ignores another origin', () => {
    expect(linkToMention(`https://example.com/projects/${A}`, ORIGIN)).toBeNull()
  })
})

describe('encodeMentions', () => {
  it('encodeMentions turns picked labels into codes', () => {
    const picked = [{ label: 'Login page', ref: { kind: 't' as const, id: A } }]
    expect(encodeMentions('fix #Login page today', picked, ORIGIN)).toBe(`fix #[t:${A}] today`)
  })

  it('encodeMentions: an edited label stays plain text', () => {
    const picked = [{ label: 'Login page', ref: { kind: 't' as const, id: A } }]
    expect(encodeMentions('fix #Login pages', picked, ORIGIN)).toBe('fix #Login pages')
    expect(encodeMentions('fix #Login pag', picked, ORIGIN)).toBe('fix #Login pag')
  })

  it('encodeMentions turns a pasted link into a code', () => {
    expect(encodeMentions(`open ${ORIGIN}/projects/${A} please`, [], ORIGIN)).toBe(`open #[p:${A}] please`)
  })

  it('encodeMentions prefers the longer label', () => {
    const picked = [
      { label: 'Login page', ref: { kind: 't' as const, id: A } },
      { label: 'Login page v2', ref: { kind: 't' as const, id: B } },
    ]
    expect(encodeMentions('#Login page v2 and #Login page', picked, ORIGIN)).toBe(`#[t:${B}] and #[t:${A}]`)
  })
})

describe('decodeForEdit', () => {
  it('decodeForEdit shows titles', () => {
    const titles = new Map([[`t:${A}`, 'Login page']])
    expect(decodeForEdit(`fix #[t:${A}]`, titles)).toEqual({
      text: 'fix #Login page',
      picked: [{ label: 'Login page', ref: { kind: 't', id: A } }],
    })
  })

  it('decodeForEdit keeps unresolved codes', () => {
    const out = decodeForEdit(`fix #[t:${A}]`, new Map())
    expect(out.text).toBe(`fix #[t:${A}]`)
    expect(encodeMentions(out.text, out.picked, ORIGIN)).toBe(`fix #[t:${A}]`)
  })
})

describe('mentionQueryAt', () => {
  it('mentionQueryAt finds # after a space and at the start', () => {
    expect(mentionQueryAt('#log', 4)).toEqual({ start: 0, query: 'log' })
    expect(mentionQueryAt('see #lo', 7)).toEqual({ start: 4, query: 'lo' })
    expect(mentionQueryAt('see #', 5)).toEqual({ start: 4, query: '' })
  })

  it('mentionQueryAt ignores # inside a word', () => {
    expect(mentionQueryAt('issue#3', 7)).toBeNull()
    expect(mentionQueryAt('a.com/#top', 10)).toBeNull()
  })

  it('mentionQueryAt stops at whitespace', () => {
    expect(mentionQueryAt('#login page', 11)).toBeNull()
    expect(mentionQueryAt(`#[t:${A}]`, 5)).toBeNull()
  })
})
