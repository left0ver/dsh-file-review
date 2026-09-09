import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test as base } from '@playwright/test'
import { PlaywrightAiFixture, type PlayWrightAiFixtureType } from '@midscene/web/playwright'

const midsceneTest = base.extend<PlayWrightAiFixtureType>(
  PlaywrightAiFixture({
    waitForNetworkIdleTimeout: 2_000,
    replanningCycleLimit: 20,
    cache: true,
  }),
)

async function readLaunchUrl(baseURL: string): Promise<string> {
  const file = path.resolve(`.e2e/dsh-web-${new URL(baseURL).port}.url`)
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const url = await readFile(file, 'utf8').catch(() => '')
    if (url !== '') return url.trim()
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for the DSH Web launch URL at ${file}`)
}

export const test = midsceneTest.extend({
  page: async ({ baseURL, page }, use) => {
    if (baseURL === undefined) throw new Error('E2E baseURL is required')
    await page.goto(await readLaunchUrl(baseURL))
    await use(page)
  },
})
