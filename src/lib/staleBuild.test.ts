import { describe, expect, it } from 'vitest'
import { isStaleBuildError } from './staleBuild'

describe('isStaleBuildError', () => {
  it('recognises a missing page chunk in each browser', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://x/assets/GroupDetail-abc.js',
      'error loading dynamically imported module: https://x/assets/Tasks-abc.js',
      'Importing a module script failed.',
      "Expected a JavaScript module script but the server responded with a MIME type of \"text/html\". Strict MIME type checking is enforced for module scripts per HTML spec. 'text/html' is not a valid JavaScript MIME type.",
      'Unable to preload CSS for /assets/index-abc.css',
    ]) {
      expect(isStaleBuildError(new Error(message))).toBe(true)
    }
  })

  it('leaves real crashes alone', () => {
    expect(isStaleBuildError(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe(false)
    expect(isStaleBuildError(null)).toBe(false)
  })
})
