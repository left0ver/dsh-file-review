/** 验证 DSH 原生审查标签页。 */

import { expect, type Locator } from '@playwright/test'
import { test } from './fixture.ts'
import {
  e2eTimeout,
  expectCardSummary,
  expectDiffLine,
  expectFileText,
  expectMultiFileCardSummary,
  expectReviewSummary,
  names,
  openNewSession,
  prepareExistingTarget,
  openFileReview,
  openReview,
  nativeReviewTab,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  standalone: targetFile('review-host-standalone.txt'),
  sidebarMultiFirst: targetFile('review-host-sidebar-multi-first.txt'),
  sidebarMultiSecond: targetFile('review-host-sidebar-multi-second.txt'),
  sidebarComment: targetFile('review-host-sidebar-comment.txt'),
  sidebarRefresh: targetFile('review-host-sidebar-refresh.txt'),
} as const

test.setTimeout(e2eTimeout)

function changedLine(review: Locator, kind: 'del' | 'add', text: string): Locator {
  const lineAttribute = kind === 'del' ? 'data-old-line' : 'data-new-line'
  return review
    .locator(`[data-line-kind="${kind}"][${lineAttribute}="1"]`)
    .filter({ hasText: text })
}

async function addComment(review: Locator, line: Locator, body: string): Promise<void> {
  await line.getByRole('button', { name: /Add comment on line 1|评论第 1 行/ }).click()
  await review.getByRole('textbox', { name: /Edit comment on line 1|编辑第 1 行的评论/ }).fill(body)
  await review.getByRole('button', { name: /^(?:Save|保存)$/ }).click()
  await expect(review.getByRole('button', { name: body, exact: true })).toBeVisible()
}

test('使用原生 Review Tab 审查文件并在编辑器中打开', async ({ page, agentForPage }) => {
  const target = files.standalone
  await prepareExistingTarget(target)
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
  await expect(nativeReviewTab(page)).toHaveCount(1)
  await review.getByRole('button', { name: /^(?:Open in editor|在编辑器中打开)$/ }).click()
  await expect(
    page.locator('[data-dockkit-tab]').filter({ hasText: target.basename }),
  ).toBeVisible()
  await nativeReviewTab(page).click()
  await expectReviewSummary(review, target, 1, 1)
})

test('原生 Tab 多文件修改后可以只审查选中的单文件', async ({ page, agentForPage }) => {
  await Promise.all([
    prepareExistingTarget(files.sidebarMultiFirst, 'first-before\n'),
    prepareExistingTarget(files.sidebarMultiSecond, 'second-before\n'),
  ])
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只修改两个文件：把 ${files.sidebarMultiFirst.relativePath} 的 first-before 改成 first-after，把 ${files.sidebarMultiSecond.relativePath} 的 second-before 改成 second-after；保留末尾换行，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, files.sidebarMultiFirst)
  await expectMultiFileCardSummary(card, [files.sidebarMultiFirst, files.sidebarMultiSecond], 2, 2)
  await expectFileText(files.sidebarMultiFirst.absolutePath, 'first-after\n')
  await expectFileText(files.sidebarMultiSecond.absolutePath, 'second-after\n')

  const review = await openFileReview(card, page, files.sidebarMultiFirst)
  await expectReviewSummary(review, files.sidebarMultiFirst, 1, 1)
  await expect(
    review.getByText(files.sidebarMultiSecond.relativePath, { exact: true }),
  ).toHaveCount(0)
  await expectDiffLine(review, 'del', 1, 'first-before')
  await expectDiffLine(review, 'add', 1, 'first-after')
})

test('原生 Tab 中的审查评论可以驱动下一轮修改', async ({ page, agentForPage }) => {
  const target = files.sidebarComment
  const comment = '请将这一行改成 final'
  await prepareExistingTarget(target)
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const firstCard = await waitForProducedCard(page, agent, target)
  await expectCardSummary(firstCard, target, 1, 1)
  await expectFileText(target.absolutePath, 'after\n')

  const firstReview = await openReview(firstCard, page)
  await expectReviewSummary(firstReview, target, 1, 1)
  await addComment(firstReview, changedLine(firstReview, 'add', 'after'), comment)

  const commentDock = page.getByRole('button', { name: names.commentDock })
  await expect(commentDock).toBeVisible()
  await sendTask(page, composer, '请严格按照审查评论修改文件，不要修改其他文件，然后结束任务。')

  const secondCard = await waitForProducedCard(page, agent, target, 2)
  await expectCardSummary(secondCard, target, 1, 1)
  await expectFileText(target.absolutePath, 'final\n')
  await expect(commentDock).toBeHidden()

  const secondReview = await openReview(secondCard, page)
  await expectReviewSummary(secondReview, target, 1, 1)
  await expectDiffLine(secondReview, 'del', 1, 'after')
  await expectDiffLine(secondReview, 'add', 1, 'final')
})

test('刷新后从历史卡片重新打开原生 Review Tab', async ({ page, agentForPage }) => {
  const target = files.sidebarRefresh
  await prepareExistingTarget(target)
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

  const initialReview = await openReview(card, page)
  await expectReviewSummary(initialReview, target, 1, 1)
  await expectDiffLine(initialReview, 'del', 1, 'before')
  await expectDiffLine(initialReview, 'add', 1, 'after')

  await page.reload()

  const restoredCard = page.getByRole('region', { name: names.producedCard }).last()
  await expect(restoredCard).toBeVisible({ timeout: 60_000 })
  const restoredReview = await openReview(restoredCard, page)
  await expect(restoredReview).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('dialog', { name: names.reviewTitle })).toHaveCount(0)
  await expectReviewSummary(restoredReview, target, 1, 1)
  await expectDiffLine(restoredReview, 'del', 1, 'before')
  await expectDiffLine(restoredReview, 'add', 1, 'after')
})
