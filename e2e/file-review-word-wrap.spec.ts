/** 验证文件审查自动换行设置的可用性、即时效果及刷新后持久化。 */

import { expect, type Locator, type Page } from '@playwright/test'
import { test } from './fixture.ts'
import {
  closeReview,
  e2eTimeout,
  expectCardSummary,
  expectDiffLine,
  names,
  openNewSession,
  openReview,
  prepareExistingTarget,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  disabled: targetFile('word-wrap-disabled.txt'),
  enabled: targetFile('word-wrap-enabled.txt'),
} as const
const beforeLine = `before-${'segment-'.repeat(24)}end`
const afterLine = `after-${'segment-'.repeat(24)}end`

test.setTimeout(e2eTimeout)

async function openWordWrapSettings(
  page: Page,
): Promise<{ readonly dialog: Locator; readonly toggle: Locator }> {
  await page.goto('/')
  await page.getByRole('button', { name: /^(?:Settings|设置)$/ }).click()
  const dialog = page.getByRole('dialog', { name: /Settings|设置/ })
  await dialog.getByRole('button', { name: /^(?:Plugins|插件)$/ }).click()
  await dialog.getByRole('button', { name: /^(?:Expand|展开): (?:File review|文件审查)$/ }).click()
  const toggle = dialog.getByRole('switch', {
    name: /Automatically wrap long lines|是否自动换行显示/,
  })
  await expect(toggle).toBeVisible()
  return { dialog, toggle }
}

async function setWordWrap(page: Page, enabled: boolean): Promise<void> {
  const { dialog, toggle } = await openWordWrapSettings(page)
  if ((await toggle.getAttribute('aria-checked')) !== String(enabled)) {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', String(enabled))
  }
  await dialog.getByRole('button', { name: /^(?:Close|关闭)$/ }).click()
  await expect(dialog).toBeHidden()
}

test.beforeEach(async ({ page }) => {
  await Promise.all([
    prepareExistingTarget(files.disabled, `${beforeLine}\n`),
    prepareExistingTarget(files.enabled, `${beforeLine}\n`),
  ])
  await setWordWrap(page, false)
})

test.afterEach(async ({ page }) => {
  await setWordWrap(page, false)
})

test('设置页公开可写的文件审查自动换行开关', async ({ page }) => {
  const { toggle } = await openWordWrapSettings(page)
  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toHaveAttribute('aria-busy', 'false')
})

test('关闭自动换行时长行 Diff 保持单行布局', async ({ page, agentForPage }) => {
  const target = files.disabled
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 第一行开头的 before- 修改成 after-，其余长文本和末尾换行保持不变，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await expectCardSummary(card, target, 1, 1)
  const review = await openReview(card, page)
  await expect(review.locator('[data-diff-layout="unified"]')).toHaveAttribute(
    'data-word-wrap',
    'false',
  )
  await expectDiffLine(review, 'del', 1, beforeLine)
  await expectDiffLine(review, 'add', 1, afterLine)
})

test('开启自动换行后长行 Diff 立即生效并在刷新后保持', async ({ page, agentForPage }) => {
  const target = files.enabled
  await setWordWrap(page, true)
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 第一行开头的 before- 修改成 after-，其余长文本和末尾换行保持不变，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  let review = await openReview(card, page)
  await expect(review.locator('[data-diff-layout="unified"]')).toHaveAttribute(
    'data-word-wrap',
    'true',
  )
  await expectDiffLine(review, 'add', 1, afterLine)
  await closeReview(review)

  await page.reload()
  const restoredCard = page.getByRole('region', { name: names.producedCard }).last()
  await expect(restoredCard).toBeVisible({ timeout: 60_000 })
  review = await openReview(restoredCard, page)
  await expect(review.locator('[data-diff-layout="unified"]')).toHaveAttribute(
    'data-word-wrap',
    'true',
  )
})
