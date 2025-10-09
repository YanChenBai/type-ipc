import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    typecheck: {
      enabled: true,
    },
    include: ['./tests/**/*.test.ts'],
  },
})
