import { describe, expect, it } from 'vitest'
import { driveLink, driveLinksIn } from './driveLinks'

const label = (href: string) => driveLink(href)?.label ?? null

describe('driveLink', () => {
  it('names each kind of Drive and Docs link', () => {
    expect(label('https://drive.google.com/drive/folders/1goDBcSnl0ePQwC1ulXZ5grRAaqQDJMgd?usp=sharing')).toBe('Google Drive folder')
    expect(label('https://drive.google.com/drive/u/0/folders/abc')).toBe('Google Drive folder')
    expect(label('https://drive.google.com/file/d/abc/view?usp=sharing')).toBe('Google Drive file')
    expect(label('https://drive.google.com/open?id=abc')).toBe('Google Drive')
    expect(label('https://docs.google.com/document/d/abc/edit')).toBe('Google Doc')
    expect(label('https://docs.google.com/spreadsheets/d/abc/edit#gid=0')).toBe('Google Sheet')
    expect(label('https://docs.google.com/presentation/d/abc/edit')).toBe('Google Slides')
    expect(label('https://docs.google.com/forms/d/e/abc/viewform')).toBe('Google Form')
    expect(label('https://forms.gle/abc')).toBe('Google Form')
  })

  it('leaves other sites alone, including look-alikes', () => {
    expect(label('https://example.com/drive/folders/abc')).toBeNull()
    expect(label('https://drive.google.com.evil.test/file/d/abc')).toBeNull()
    expect(label('https://docs.google.com/unknown/abc')).toBeNull()
    expect(label('not a url')).toBeNull()
  })
})

describe('driveLinksIn', () => {
  it('lists each Drive link once, skipping the rest', () => {
    const doc = 'https://docs.google.com/document/d/abc/edit'
    const found = driveLinksIn(`Brief ${doc} and again ${doc}, plus https://example.com`)
    expect(found.map((d) => d.href)).toEqual([doc])
  })
})
