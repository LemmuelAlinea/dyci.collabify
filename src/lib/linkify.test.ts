import { describe, expect, it } from 'vitest'
import { linkify } from './linkify'

const links = (text: string) => linkify(text).filter((p) => p.kind === 'link').map((p) => p.kind === 'link' && p.href)

describe('linkify', () => {
  it('finds a Google Drive link and keeps the text around it', () => {
    const url = 'https://drive.google.com/drive/folders/1goDBcSnl0ePQwC1ulXZ5grRAaqQDJMgd?usp=sharing'
    expect(linkify(`Files here: ${url} — thanks`)).toEqual([
      { kind: 'text', text: 'Files here: ' },
      { kind: 'link', text: url, href: url },
      { kind: 'text', text: ' — thanks' },
    ])
  })

  it('leaves sentence punctuation and an unopened bracket outside', () => {
    expect(links('See https://example.com/a.')).toEqual(['https://example.com/a'])
    expect(links('(see https://example.com/a)')).toEqual(['https://example.com/a'])
    expect(links('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
  })

  it('adds https to a bare www link and finds several', () => {
    expect(links('www.dyci.edu.ph and http://a.test/x, then https://b.test')).toEqual([
      'https://www.dyci.edu.ph',
      'http://a.test/x',
      'https://b.test',
    ])
  })

  it('does not link other schemes or plain text', () => {
    expect(links('javascript:alert(1) mailto:a@b.c ftp://x.test just words')).toEqual([])
    expect(linkify('')).toEqual([])
  })
})
