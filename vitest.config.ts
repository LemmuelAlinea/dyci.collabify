import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `node`, not `jsdom`: everything under test here is pure — dates, CSV,
    // arithmetic over rows. Nothing touches the DOM, and adding a fake one
    // would only slow the run and invite tests that lean on it.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { include: ['src/lib/**/*.ts'], exclude: ['src/lib/**/*.test.ts'] },
  },
})
