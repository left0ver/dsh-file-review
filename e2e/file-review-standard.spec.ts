/** 验证标准模式下单文件、多行局部修改和多文件修改的审查展示。 */

import { expect } from '@playwright/test'
import { test } from './fixture.ts'
import {
  e2eTimeout,
  expectCardSummary,
  expectDiffLine,
  expectFileText,
  expectMultiFileCardSummary,
  expectMultiFileReviewSummary,
  expectReviewSummary,
  closeReview,
  openNewSession,
  openFileReview,
  openReview,
  prepareExistingTarget,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  single: targetFile('standard-review.txt'),
  multiline: targetFile('standard-multiline.txt'),
  first: targetFile('standard-first.txt'),
  second: targetFile('standard-second.txt'),
} as const

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await Promise.all([
    prepareExistingTarget(files.single),
    prepareExistingTarget(files.multiline, 'alpha\nmiddle\nomega\n'),
    prepareExistingTarget(files.first, 'first-before\n'),
    prepareExistingTarget(files.second, 'second-before\n'),
  ])
})

test('标准模式可以审查 Agent 对已有文件的编辑', async ({ page, agentForPage }) => {
  const target = files.single
  const composer = await openNewSession(page, 'standard')
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
  await expect(review.getByRole('button', { name: /Copy diff|复制差异/ })).toBeEnabled()
})

test('多行文件只修改中间行时显示省略提示和准确行号', async ({ page, agentForPage }) => {
  const target = files.multiline
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 第 2 行的 middle 修改成 center，保留第 1 行 alpha、第 3 行 omega 和文件末尾换行，不要修改其他文件，然后结束任务。`,
  )

  const card = await waitForProducedCard(page, agent, target)
  await expectCardSummary(card, target, 1, 1)
  await expectFileText(target.absolutePath, 'alpha\ncenter\nomega\n')

  const review = await openReview(card, page)
  await expectReviewSummary(review, target, 1, 1)
  await expect(review).toContainText(/1 unchanged lines|显示 1 行未更改内容/)
  await expect(review.locator('[data-line-kind="context"]')).toHaveCount(0)
  await expectDiffLine(review, 'del', 2, 'middle')
  await expectDiffLine(review, 'add', 2, 'center')
})

test('双文件修改支持总览和单文件审查', async ({ page, agentForPage }) => {
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只修改两个文件：把 ${files.first.relativePath} 的 first-before 改成 first-after，把 ${files.second.relativePath} 的 second-before 改成 second-after；保留末尾换行，不要修改其他文件，然后结束任务。`,
  )

  const card = await waitForProducedCard(page, agent, files.first)
  await expectMultiFileCardSummary(card, [files.first, files.second], 2, 2)
  await expectFileText(files.first.absolutePath, 'first-after\n')
  await expectFileText(files.second.absolutePath, 'second-after\n')

  const fileReview = await openFileReview(card, page, files.first)
  await expectReviewSummary(fileReview, files.first, 1, 1)
  await expect(fileReview.getByText(files.second.relativePath, { exact: true })).toHaveCount(0)
  await expectDiffLine(fileReview, 'del', 1, 'first-before')
  await expectDiffLine(fileReview, 'add', 1, 'first-after')
  await closeReview(fileReview)

  const allReview = await openReview(card, page)
  await expectMultiFileReviewSummary(allReview, [files.first, files.second], 2, 2)
  await expectDiffLine(allReview, 'del', 1, 'first-before')
  await expectDiffLine(allReview, 'add', 1, 'first-after')
  await expectDiffLine(allReview, 'del', 1, 'second-before')
  await expectDiffLine(allReview, 'add', 1, 'second-after')
})
