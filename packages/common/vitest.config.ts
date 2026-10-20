import { defineConfig } from 'vitest/config'

// Tests are pure (no DOM): jsdom is not a dependency of this package.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
