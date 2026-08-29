import { test as base } from '@playwright/test'
import { PlaywrightAiFixture, type PlayWrightAiFixtureType } from '@midscene/web/playwright'

export const test = base.extend<PlayWrightAiFixtureType>(
  PlaywrightAiFixture({
    waitForNetworkIdleTimeout: 2_000,
    replanningCycleLimit: 20,
    cache: true,
  }),
)
