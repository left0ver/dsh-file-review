import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    restoreMocks: true,
    server: {
      deps: { inline: [/katex/] },
    },
  },
})
