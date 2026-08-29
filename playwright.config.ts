import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { defineConfig } from '@playwright/test'

const root = process.cwd()
const envFile = path.join(root, '.env.e2e')
const port = 3081

if (existsSync(envFile)) {
  Object.assign(process.env, parseEnv(readFileSync(envFile, 'utf8')))
}

export default defineConfig({
  testDir: './e2e',
  timeout: 3 * 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['@midscene/web/playwright-reporter', { type: 'merged' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `dsh web --patch "${path.join(root, 'e2e/dsh.patch.yml')}" --no-open --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DSH_HOME: path.join(root, '.e2e/dsh-home'),
    },
  },
})
