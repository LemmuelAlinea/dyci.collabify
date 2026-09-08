import { describe, expect, it } from 'vitest'

import { AVATAR_ACCEPT, LIMIT, avatarExtension, avatarProblem } from './limits'

/** A stand-in File. `File` exists in node 20+, but this keeps the type honest. */
function fileOf(name: string, type: string, bytes: number): File {
  return { name, type, size: bytes } as File
}

describe('avatarProblem', () => {
  it('accepts a PNG and a JPEG under the size limit', () => {
    expect(avatarProblem(fileOf('me.png', 'image/png', 500_000))).toBeNull()
    expect(avatarProblem(fileOf('me.jpg', 'image/jpeg', 500_000))).toBeNull()
  })

  /**
   * The one that matters. The old code took the extension off the file name to
   * build the storage path, so an SVG renamed to `.png` would have been stored
   * as a PNG in a public bucket that Supabase serves without
   * `X-Content-Type-Options` — active content on the project's own origin.
   */
  it('refuses an SVG wearing a PNG file name', () => {
    expect(avatarProblem(fileOf('photo.png', 'image/svg+xml', 1000))).toMatch(/PNG or a JPG/)
  })

  it('refuses HTML, whatever it is called', () => {
    expect(avatarProblem(fileOf('avatar.jpg', 'text/html', 1000))).toMatch(/PNG or a JPG/)
  })

  // Dropped from the accept list when the bucket allowlist was written: the
  // public bucket keeps the shortest list the product actually needs.
  it('refuses WebP, which used to be offered', () => {
    expect(avatarProblem(fileOf('me.webp', 'image/webp', 1000))).toMatch(/PNG or a JPG/)
  })

  it('refuses anything over two megabytes', () => {
    expect(avatarProblem(fileOf('big.png', 'image/png', 2 * 1024 * 1024 + 1))).toMatch(/2 MB/)
    expect(avatarProblem(fileOf('ok.png', 'image/png', 2 * 1024 * 1024))).toBeNull()
  })

  it('reports the type before the size, since the type is the security one', () => {
    expect(avatarProblem(fileOf('x.svg', 'image/svg+xml', 9_000_000))).toMatch(/PNG or a JPG/)
  })
})

describe('avatarExtension', () => {
  // Taken from the type, never the name, so the stored path cannot claim to be
  // something the file is not.
  it('comes from the type and not the file name', () => {
    expect(avatarExtension(fileOf('whatever.jpeg', 'image/png', 1))).toBe('png')
    expect(avatarExtension(fileOf('whatever.png', 'image/jpeg', 1))).toBe('jpg')
  })
})

describe('the accept attribute', () => {
  it('offers exactly what the bucket accepts', () => {
    expect(AVATAR_ACCEPT).toBe('image/png,image/jpeg')
  })
})

describe('LIMIT', () => {
  it('is a positive whole number of characters everywhere', () => {
    for (const [key, value] of Object.entries(LIMIT)) {
      expect(Number.isInteger(value), key).toBe(true)
      expect(value, key).toBeGreaterThan(0)
    }
  })

  // A field somebody writes a paragraph into needs more room than a name.
  it('gives bodies more room than labels', () => {
    expect(LIMIT.messageBody).toBeGreaterThan(LIMIT.className)
    expect(LIMIT.projectGuidelines).toBeGreaterThan(LIMIT.projectTitle)
    expect(LIMIT.email).toBe(254) // RFC 5321
  })
})
