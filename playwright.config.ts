import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { defineConfig } from '@playwright/test'

const root = process.cwd()
const envFile = path.join(root, '.env.e2e')

if (existsSync(envFile)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(envFile, 'utf8')))) {
    process.env[key] ??= value
  }
}

const port = 3081
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  timeout: 7 * 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['@midscene/web/playwright-reporter', { type: 'merged' }]],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'standalone', use: { baseURL } }],
  webServer: {
    command: `node "${path.join(root, 'e2e/start-dsh.mjs')}" ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: process.env,
  },
})
