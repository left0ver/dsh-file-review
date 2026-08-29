import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { defineConfig } from '@playwright/test'

const root = process.cwd()
const envFile = path.join(root, '.env.e2e')
const variants = ['standalone', 'better-sidebar'] as const
type E2EVariant = (typeof variants)[number]

if (existsSync(envFile)) {
  Object.assign(process.env, parseEnv(readFileSync(envFile, 'utf8')))
}

const requestedVariant = process.env.E2E_VARIANT
if (requestedVariant !== undefined && !variants.includes(requestedVariant as E2EVariant)) {
  throw new Error(
    `E2E_VARIANT must be one of ${variants.join(', ')}; received ${JSON.stringify(requestedVariant)}`,
  )
}

const enabledVariants = variants.filter(
  (variant) => requestedVariant === undefined || requestedVariant === variant,
)
const ports: Record<E2EVariant, number> = {
  standalone: 3081,
  'better-sidebar': 3082,
}

function serverFor(variant: E2EVariant) {
  const port = ports[variant]
  return {
    command: `node "${path.join(root, 'e2e/start-dsh.mjs')}" ${variant} ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: process.env,
  }
}

export default defineConfig({
  testDir: './e2e',
  timeout: 7 * 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['@midscene/web/playwright-reporter', { type: 'merged' }]],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: enabledVariants.map((variant) => ({
    name: variant,
    metadata: { reviewHost: variant },
    ...(variant === 'better-sidebar' ? { testMatch: '**/file-review-host.spec.ts' } : {}),
    use: {
      baseURL: `http://127.0.0.1:${ports[variant]}`,
    },
  })),
  webServer: enabledVariants.map(serverFor),
})
