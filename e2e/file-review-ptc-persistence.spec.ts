/** 验证 PTC 模式产生的已有文件和新建文件审查，以及刷新后的持久化与切换操作。 */

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
  prepareMissingTarget,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  review: targetFile('ptc-review.txt'),
  persistence: targetFile('ptc-persistence.txt'),
  created: targetFile('ptc-created.txt'),
} as const

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await Promise.all([
    prepareExistingTarget(files.review),
    prepareExistingTarget(files.persistence),
    prepareMissingTarget(files.created),
  ])
})

test('PTC 模式产生可审查的已有文件 Diff', async ({ page, agentForPage }) => {
  const target = files.review
  const composer = await openNewSession(page, 'code')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await expectCardSummary(card, target, 1, 1)
  await expectFileText(target.absolutePath, 'after\n')

  const review = await openReview(card, page)
  await expectReviewSummary(review, target, 1, 1)
  await expectDiffLine(review, 'del', 1, 'before')
  await expectDiffLine(review, 'add', 1, 'after')
})

test('PTC 模式的审查数据在刷新后仍可查看和撤销', async ({ page, agentForPage }) => {
  const target = files.persistence
  const composer = await openNewSession(page, 'code')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const initialCard = await waitForProducedCard(page, agent, target)
  await expectCardSummary(initialCard, target, 1, 1)
  await expectFileText(target.absolutePath, 'after\n')

  const initialReview = await openReview(initialCard, page)
  await expectReviewSummary(initialReview, target, 1, 1)
  await expectDiffLine(initialReview, 'del', 1, 'before')
  await expectDiffLine(initialReview, 'add', 1, 'after')
  await closeReview(initialReview)

  await page.reload()
  const restoredCard = page.getByRole('region', { name: names.producedCard }).last()
  await expect(restoredCard).toBeVisible({ timeout: 60_000 })
  await expectCardSummary(restoredCard, target, 1, 1)

  const restoredReview = await openReview(restoredCard, page)
  await expectReviewSummary(restoredReview, target, 1, 1)
  await expectDiffLine(restoredReview, 'del', 1, 'before')
  await expectDiffLine(restoredReview, 'add', 1, 'after')
  await closeReview(restoredReview)

  await restoredCard.getByRole('button', { name: names.undo }).click()
  await expectSuccessfulToggle(page, 'undo')
  await expectFileText(target.absolutePath, 'before\n')
  await expect(restoredCard.getByRole('button', { name: names.reapply })).toBeEnabled()
})

test('PTC 模式创建的新文件可以审查、撤销并重新应用', async ({ page, agentForPage }) => {
  const target = files.created
  const composer = await openNewSession(page, 'code')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只创建 ${target.relativePath}，文件内容必须恰好为 ptc-created 加一个换行，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await expectCardSummary(card, target, 1, 0)
  await expectFileText(target.absolutePath, 'ptc-created\n')

  const review = await openReview(card, page)
  await expectReviewSummary(review, target, 1, 0)
  await expect(review.locator('[data-line-kind="del"]')).toHaveCount(0)
  await expectDiffLine(review, 'add', 1, 'ptc-created')
  await closeReview(review)

  await card.getByRole('button', { name: names.undo }).click()
  await expectSuccessfulToggle(page, 'undo')
  await expectFileText(target.absolutePath, null)
  await card.getByRole('button', { name: names.reapply }).click()
  await expectSuccessfulToggle(page, 'reapply')
  await expectFileText(target.absolutePath, 'ptc-created\n')
})
