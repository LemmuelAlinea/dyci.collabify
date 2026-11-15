import { describe, expect, it } from 'vitest'
import { editingLabel, newVersionProblem, pulledAgo, stalePushMessage, unknownCopyMessage } from './newVersion'

const picked = (name: string, size = 10) => new File([new Uint8Array(size)], name)

describe('newVersionProblem', () => {
  it('passes a file of the same type', () => {
    expect(newVersionProblem('Thesis/Chap1-4.docx', picked('Chap1-4 (Ana).docx'))).toBeNull()
    expect(newVersionProblem('a/Report.PDF', picked('report.pdf'))).toBeNull()
  })

  it('refuses a .pdf for a .docx', () => {
    expect(newVersionProblem('Thesis/Chap1-4.docx', picked('Chap1-4.pdf'))).toBe(
      'Pick a .docx file. This one replaces Chap1-4.docx, so it has to be the same type.',
    )
  })

  it('refuses a .doc for a .docx', () => {
    expect(newVersionProblem('Chap1-4.docx', picked('Chap1-4.doc'))).toBe(
      'Pick a .docx file. This one replaces Chap1-4.docx, so it has to be the same type.',
    )
  })

  it('refuses a file over 50 MB', () => {
    const big = picked('Chap1-4.docx')
    Object.defineProperty(big, 'size', { value: 50 * 1024 * 1024 + 1 })
    expect(newVersionProblem('Chap1-4.docx', big)).toMatch(/^Files can be up to 50 MB\./)
  })
})

describe('pulledAgo', () => {
  const now = Date.parse('2026-11-15T12:00:00Z')
  const at = (ms: number) => new Date(now - ms).toISOString()

  it('reads as a relative time', () => {
    expect(pulledAgo(at(20_000), now)).toBe('just now')
    expect(pulledAgo(at(60_000), now)).toBe('1 minute ago')
    expect(pulledAgo(at(5 * 60_000), now)).toBe('5 minutes ago')
    expect(pulledAgo(at(2 * 3600_000), now)).toBe('2 hours ago')
    expect(pulledAgo(at(26 * 3600_000), now)).toBe('1 day ago')
    expect(pulledAgo(at(3 * 86400_000), now)).toBe('3 days ago')
  })
})

describe('editingLabel', () => {
  it('names who is editing', () => {
    expect(editingLabel([])).toBeNull()
    expect(editingLabel(['Ana'])).toBe('Ana is editing')
    expect(editingLabel(['Ana', 'Ben'])).toBe('Ana and Ben are editing')
    expect(editingLabel(['Ana', 'Ben', 'Cy'])).toBe('Ana and 2 others are editing')
  })
})

describe('stalePushMessage', () => {
  const stale = {
    message:
      'Main has a newer version of Thesis/Chap1-4.docx than the copy this was made from. Get the newer version, combine the two in Word, then upload again.',
  }

  it('tells the pusher what to do', () => {
    expect(stalePushMessage(stale, null)).toBe(
      'Main has a newer version of Thesis/Chap1-4.docx than the copy you started from. You have to get the newer version, combine the two in Word and upload again.',
    )
  })

  it('names the change author for a reviewer', () => {
    expect(stalePushMessage(stale, 'Ana Cruz')).toBe(
      'Main has a newer version of Thesis/Chap1-4.docx than the copy Ana Cruz started from. Ana Cruz has to get the newer version, combine the two in Word and upload again.',
    )
  })

  it('names Excel for an Excel file', () => {
    const excel = {
      message:
        'Main has a newer version of Budget/Budget.xlsx than the copy this was made from. Get the newer version, combine the two in Word or Excel, then upload again.',
    }
    expect(stalePushMessage(excel, null)).toBe(
      'Main has a newer version of Budget/Budget.xlsx than the copy you started from. You have to get the newer version, copy your changes into the newer version in Excel and upload again.',
    )
  })

  it('starts the second sentence with a capital for a lowercase name', () => {
    expect(stalePushMessage(stale, 'its author')).toContain('than the copy its author started from. Its author has to')
  })

  it('leaves every other error alone', () => {
    expect(stalePushMessage({ message: 'permission denied' }, null)).toBeNull()
    expect(stalePushMessage(null, null)).toBeNull()
  })
})

describe('unknownCopyMessage', () => {
  it("names Main's version by its date", () => {
    const at = '2026-11-14T02:00:00Z'
    expect(unknownCopyMessage(at)).toBe(
      `Collabify doesn't know which copy you started from. If it wasn't Main's version from ${new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, someone's changes may be lost.`,
    )
  })

  it('falls back to its last commit without a date', () => {
    expect(unknownCopyMessage(null)).toBe(
      "Collabify doesn't know which copy you started from. If it wasn't Main's version from its last commit, someone's changes may be lost.",
    )
  })
})
