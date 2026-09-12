/** 验证原生审查 Tab 的 Diff 复制、重复打开与关闭重开。 */

import { expect } from '@playwright/test'
import { test } from './fixture.ts'
import {
  closeReview,
  e2eTimeout,
  expectCardSummary,
  expectFileText,
  names,
  nativeReviewTab,
  openNewSession,
  openReview,
  prepareExistingTarget,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  copy: targetFile('review-copy.txt'),
  focus: targetFile('review-focus.txt'),
} as const

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await Promise.all([prepareExistingTarget(files.copy), prepareExistingTarget(files.focus)])
})

test('复制 Diff 会写入完整文件差异并反馈成功状态', async ({ page, agentForPage }) => {
  const target = files.copy
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await expectFileText(target.absolutePath, 'after\n')

  const review = await openReview(card, page)
  await review.getByRole('button', { name: /^(?:Copy diff|复制差异)$/ }).click()
  await expect(review.getByRole('button', { name: /^(?:Copied|已复制)$/ })).toBeVisible()
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboard.replaceAll('\\', '/')).toContain(target.relativePath)
  expect(clipboard).toContain('- before')
  expect(clipboard).toContain('+ after')
})

test('重复打开复用原生 Tab，关闭后可重新打开', async ({ page, agentForPage }) => {
  const target = files.focus
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await expectCardSummary(card, target, 1, 1)
  const opener = card.getByRole('button', { name: names.reviewAll })

  const review = await openReview(card, page)
  const tab = nativeReviewTab(page)
  const tabId = await tab.getAttribute('data-dockkit-tab')
  await opener.click()
  await expect(tab).toHaveCount(1)
  await expect(tab).toHaveAttribute('data-dockkit-tab', tabId!)
  await closeReview(review)
  await expect(tab).toHaveCount(0)
  const reopened = await openReview(card, page)
  await expect(reopened.getByText(target.relativePath, { exact: true })).toBeVisible()
})
