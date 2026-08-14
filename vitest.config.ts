import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    restoreMocks: true,
    server: {
      deps: {
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/, /katex/],
      },
    },
  },
})
