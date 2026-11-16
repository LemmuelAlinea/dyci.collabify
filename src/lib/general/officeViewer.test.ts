import { describe, expect, it } from 'vitest'
import { officePreviewable, officeViewerReachable, officeViewerUrl } from './officeViewer'

describe("Microsoft's Office viewer", () => {
  it('passes the signed link to the viewer, encoded', () => {
    const signed = 'https://x.supabase.co/storage/v1/object/sign/general-files/p/files/a-Chap1-4.docx?token=a.b&c=1'
    const url = officeViewerUrl(signed)
    expect(url.startsWith('https://view.officeapps.live.com/op/embed.aspx?src=')).toBe(true)
    expect(decodeURIComponent(url.split('src=')[1])).toBe(signed)
    expect(url).not.toContain('&c=1')
  })

  it('is used only where Microsoft can reach the file', () => {
    expect(officeViewerReachable('dyci-collabify.vercel.app')).toBe(true)
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'app.localhost', 'collabify.test']) {
      expect(officeViewerReachable(host)).toBe(false)
    }
  })

  it('previews .docx, .xlsx and .xlsm everywhere, and .xls only where the viewer reaches it', () => {
    for (const host of ['dyci-collabify.vercel.app', 'localhost']) {
      expect(officePreviewable('a/Chap1.docx', host)).toBe(true)
      expect(officePreviewable('a/Budget.xlsx', host)).toBe(true)
      expect(officePreviewable('a/Macros.XLSM', host)).toBe(true)
      expect(officePreviewable('a/Consent.pdf', host)).toBe(false)
      expect(officePreviewable('a/Old.doc', host)).toBe(true)
    }
    expect(officePreviewable('a/Old.xls', 'dyci-collabify.vercel.app')).toBe(true)
    expect(officePreviewable('a/Old.xls', 'localhost')).toBe(false)
  })
})
