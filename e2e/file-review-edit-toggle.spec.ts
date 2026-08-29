/** 验证已有文件编辑的审查、撤销、重新应用以及刷新后的状态和 Diff 保留。 */

import { expect } from '@playwright/test'
import { test } from './fixture.ts'
import {
  closeReview,
  e2eTimeout,
  expectCardSummary,
  expectDiffLine,
  expectFileText,
  expectReviewSummary,
  expectSuccessfulToggle,
  names,
  openNewSession,
  openReview,
  prepareExistingTarget,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  roundTrip: targetFile('edit-toggle.txt'),
  reload: targetFile('edit-toggle-reload.txt'),
  review: targetFile('edit-toggle-review.txt'),
} as const

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await Promise.all([
    prepareExistingTarget(files.roundTrip),
    prepareExistingTarget(files.reload),
    prepareExistingTarget(files.review),
  ])
})

test('已有文件的编辑可以撤销并重新应用', async ({ page, agentForPage }) => {
  const target = files.roundTrip
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await expectCardSummary(card, target, 1, 1, 'undo')
  await expectFileText(target.absolutePath, 'after\n')

  await card.getByRole('button', { name: names.undo }).click()
  await expectSuccessfulToggle(page, 'undo')
  await expectFileText(target.absolutePath, 'before\n')
  await expect(card.getByRole('button', { name: names.reapply })).toBeEnabled()
  await expect(card.getByRole('button', { name: names.undo })).toHaveCount(0)

  await card.getByRole('button', { name: names.reapply }).click()
  await expectSuccessfulToggle(page, 'reapply')
  await expectFileText(target.absolutePath, 'after\n')
  await expect(card.getByRole('button', { name: names.undo })).toBeEnabled()
  await expect(card.getByRole('button', { name: names.reapply })).toHaveCount(0)
})

test('撤销后刷新不会改写磁盘且历史审查仍可查看', async ({ page, agentForPage }) => {
  const target = files.reload
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await card.getByRole('button', { name: names.undo }).click()
  await expectSuccessfulToggle(page, 'undo')
  await expectFileText(target.absolutePath, 'before\n')

  await page.reload()
  const restoredCard = page.getByRole('region', { name: names.producedCard }).last()
  await expect(restoredCard).toBeVisible({ timeout: 60_000 })
  await expect(restoredCard.getByText(target.basename, { exact: true })).toBeVisible()
  await expect(restoredCard.getByRole('button', { name: names.reviewAll })).toBeEnabled()
  await expectFileText(target.absolutePath, 'before\n')

  const restoredReview = await openReview(restoredCard, page)
  await expectReviewSummary(restoredReview, target, 1, 1)
  await expectDiffLine(restoredReview, 'del', 1, 'before')
  await expectDiffLine(restoredReview, 'add', 1, 'after')
})

test('撤销和重新应用不会丢失原始审查 Diff', async ({ page, agentForPage }) => {
  const target = files.review
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)

  const initialReview = await openReview(card, page)
  await expectReviewSummary(initialReview, target, 1, 1)
  await expectDiffLine(initialReview, 'del', 1, 'before')
  await expectDiffLine(initialReview, 'add', 1, 'after')
  await closeReview(initialReview)

  await card.getByRole('button', { name: names.undo }).click()
  await expectSuccessfulToggle(page, 'undo')
  const undoneReview = await openReview(card, page)
  await expectDiffLine(undoneReview, 'del', 1, 'before')
  await expectDiffLine(undoneReview, 'add', 1, 'after')
  await closeReview(undoneReview)

  await card.getByRole('button', { name: names.reapply }).click()
  await expectSuccessfulToggle(page, 'reapply')
  const reappliedReview = await openReview(card, page)
  await expectDiffLine(reappliedReview, 'del', 1, 'before')
  await expectDiffLine(reappliedReview, 'add', 1, 'after')
})
