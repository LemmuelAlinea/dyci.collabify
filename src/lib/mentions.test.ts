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
  uniqueLabel,
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

describe('uniqueLabel', () => {
  it('uniqueLabel keeps a free title', () => {
    expect(uniqueLabel('Docs', 'Web', [], { kind: 't', id: A })).toBe('Docs')
  })

  it('uniqueLabel adds the project when another mention has the title', () => {
    const picked = [{ label: 'Docs', ref: { kind: 't' as const, id: A } }]
    expect(uniqueLabel('Docs', 'Mobile', picked, { kind: 't', id: B })).toBe('Docs (Mobile)')
    expect(uniqueLabel('Docs', 'Web', picked, { kind: 't', id: A })).toBe('Docs')
  })

  it('uniqueLabel numbers it when the project is taken too', () => {
    const picked = [
      { label: 'Docs', ref: { kind: 't' as const, id: A } },
      { label: 'Docs (Web)', ref: { kind: 't' as const, id: B } },
    ]
    expect(uniqueLabel('Docs', 'Web', picked, { kind: 'ct', id: A })).toBe('Docs (Web) (2)')
  })

  it('two mentions with the same title keep their own targets', () => {
    const picked = [
      { label: 'Docs', ref: { kind: 't' as const, id: A } },
      { label: uniqueLabel('Docs', 'Mobile', [{ label: 'Docs', ref: { kind: 't', id: A } }], { kind: 't', id: B }), ref: { kind: 't' as const, id: B } },
    ]
    expect(encodeMentions('#Docs and #Docs (Mobile)', picked, ORIGIN)).toBe(`#[t:${A}] and #[t:${B}]`)
  })
})

describe('decodeForEdit', () => {
  it('decodeForEdit keeps same-title mentions apart', () => {
    const titles = new Map([
      [`t:${A}`, 'Docs'],
      [`t:${B}`, 'Docs'],
    ])
    const out = decodeForEdit(`#[t:${A}] #[t:${B}]`, titles)
    expect(out.text).toBe('#Docs #Docs (2)')
    expect(encodeMentions(out.text, out.picked, ORIGIN)).toBe(`#[t:${A}] #[t:${B}]`)
  })

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

  it('mentionQueryAt keeps spaces in a multi-word query', () => {
    expect(mentionQueryAt('Test: #sample t', 15)).toEqual({ start: 6, query: 'sample t' })
  })

  it('mentionQueryAt stops at a new line, a code, or 40 characters', () => {
    expect(mentionQueryAt('#login\npage', 11)).toBeNull()
    expect(mentionQueryAt(`#[t:${A}]`, 5)).toBeNull()
    expect(mentionQueryAt(`#${'a'.repeat(41)}`, 42)).toBeNull()
  })

  it('mentionQueryAt leaves text after a picked mention alone', () => {
    const picked = [{ label: 'Sample Task', ref: { kind: 't' as const, id: A } }]
    expect(mentionQueryAt('#Sample Task', 12, picked)).toBeNull()
    expect(mentionQueryAt('#Sample Task is done', 20, picked)).toBeNull()
    expect(mentionQueryAt('#Sample Ta', 10, picked)).toEqual({ start: 0, query: 'Sample Ta' })
  })
})
