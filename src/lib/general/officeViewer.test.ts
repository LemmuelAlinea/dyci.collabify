import { describe, expect, it } from 'vitest'
import { officeViewerReachable, officeViewerUrl } from './officeViewer'

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
})
