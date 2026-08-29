/** 验证文件审查抽屉的 Diff 复制、宽度持久化以及关闭后的焦点恢复。 */

import { expect } from '@playwright/test'
import { test } from './fixture.ts'
import {
  closeReview,
  e2eTimeout,
  expectCardSummary,
  expectFileText,
  names,
  openNewSession,
  openReview,
  prepareExistingTarget,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  copy: targetFile('review-copy.txt'),
  resize: targetFile('review-resize.txt'),
  focus: targetFile('review-focus.txt'),
} as const

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await Promise.all([
    prepareExistingTarget(files.copy),
    prepareExistingTarget(files.resize),
    prepareExistingTarget(files.focus),
  ])
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
  expect(clipboard).toContain(target.absolutePath)
  expect(clipboard).toContain('- before')
  expect(clipboard).toContain('+ after')
})

test('键盘调整 Review 宽度后关闭重开仍保持尺寸', async ({ page, agentForPage }) => {
  const target = files.resize
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  let review = await openReview(card, page)
  let handle = review.getByRole('separator', { name: /Resize review panel|调整审查面板大小/ })
  const initialWidth = Number(await handle.getAttribute('aria-valuenow'))

  await handle.focus()
  await handle.press('ArrowLeft')
  const resizedWidth = Number(await handle.getAttribute('aria-valuenow'))
  expect(resizedWidth).toBeGreaterThan(initialWidth)
  await closeReview(review)

  review = await openReview(card, page)
  handle = review.getByRole('separator', { name: /Resize review panel|调整审查面板大小/ })
  await expect(handle).toHaveAttribute('aria-valuenow', String(resizedWidth))
  await handle.dblclick()
  await expect(handle).not.toHaveAttribute('aria-valuenow', String(resizedWidth))
})

test('关闭 Review 后焦点返回原卡片按钮', async ({ page, agentForPage }) => {
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
  await expect(review.getByRole('button', { name: names.close })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(review).toBeHidden()
  await expect(opener).toBeFocused()
})
