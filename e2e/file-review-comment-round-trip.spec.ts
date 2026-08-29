/** 验证审查评论的新增、编辑、删除、汇总以及发送给 Agent 后的修改闭环。 */

import { expect, type Locator } from '@playwright/test'
import { test } from './fixture.ts'
import {
  closeReview,
  e2eTimeout,
  expectCardSummary,
  expectDiffLine,
  expectFileText,
  expectReviewSummary,
  names,
  openNewSession,
  openReview,
  prepareExistingTarget,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  roundTrip: targetFile('comment-round-trip.txt'),
  editedComment: targetFile('comment-edit.txt'),
  multipleComments: targetFile('comment-multiple.txt'),
} as const
const comment = '请将这一行改成 final'

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await Promise.all([
    prepareExistingTarget(files.roundTrip),
    prepareExistingTarget(files.editedComment),
    prepareExistingTarget(files.multipleComments),
  ])
})

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

test('审查评论会发送给 Agent 并形成下一轮修改', async ({ page, agentForPage }) => {
  const target = files.roundTrip
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
  await expectDiffLine(firstReview, 'del', 1, 'before')
  await expectDiffLine(firstReview, 'add', 1, 'after')

  await addComment(firstReview, changedLine(firstReview, 'add', 'after'), comment)

  const commentDock = page.getByRole('button', { name: names.commentDock })
  await expect(commentDock).toBeVisible()
  await commentDock.focus()
  const draftPreview = page.getByRole('tooltip', { name: names.commentPreview })
  await expect(draftPreview).toContainText(target.relativePath)
  await expect(draftPreview).toContainText(/right line 1|右侧第 1 行/)
  await expect(draftPreview).toContainText(comment)
  await closeReview(firstReview)

  await sendTask(page, composer, '请严格按照审查评论修改文件，不要修改其他文件，然后结束任务。')
  const secondCard = await waitForProducedCard(page, agent, target, 2)
  await expectCardSummary(secondCard, target, 1, 1)
  await expectFileText(target.absolutePath, 'final\n')
  await expect(commentDock).toBeHidden()

  const historicalComment = page.getByRole('button', { name: names.commentHistory })
  await expect(historicalComment).toBeVisible()
  await historicalComment.focus()
  const historicalPreview = page.getByRole('tooltip', { name: names.commentPreview })
  await expect(historicalPreview).toContainText(target.relativePath)
  await expect(historicalPreview).toContainText(comment)

  const secondReview = await openReview(secondCard, page)
  await expectReviewSummary(secondReview, target, 1, 1)
  await expectDiffLine(secondReview, 'del', 1, 'after')
  await expectDiffLine(secondReview, 'add', 1, 'final')
})

test('已保存评论可以编辑并通过 dock 一次清空', async ({ page, agentForPage }) => {
  const target = files.editedComment
  const firstBody = '请检查这个用词'
  const revisedBody = '请将这一行改成更清晰的 final'
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  const review = await openReview(card, page)
  await addComment(review, changedLine(review, 'add', 'after'), firstBody)

  await review.getByRole('button', { name: firstBody, exact: true }).click()
  const editor = review.getByRole('textbox', {
    name: /Edit comment on line 1|编辑第 1 行的评论/,
  })
  await expect(editor).toHaveValue(firstBody)
  await editor.fill(revisedBody)
  await review.getByRole('button', { name: /^(?:Save|保存)$/ }).click()
  await expect(review.getByRole('button', { name: firstBody, exact: true })).toHaveCount(0)
  await expect(review.getByRole('button', { name: revisedBody, exact: true })).toBeVisible()

  const dock = page.getByRole('button', { name: names.commentDock })
  await dock.focus()
  const preview = page.getByRole('tooltip', { name: names.commentPreview })
  await expect(preview).toContainText(revisedBody)
  await expect(preview).not.toContainText(firstBody)

  await page.getByRole('button', { name: /Remove all review comments|移除全部审查评论/ }).click()
  await expect(dock).toBeHidden()
  await expect(review.getByRole('button', { name: revisedBody, exact: true })).toHaveCount(0)
})

test('同一 Diff 的多条评论可以独立删除', async ({ page, agentForPage }) => {
  const target = files.multipleComments
  const deletedBody = '不要删除 before'
  const keptBody = '请把新增内容改成 final'
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  const review = await openReview(card, page)
  await addComment(review, changedLine(review, 'del', 'before'), deletedBody)
  await addComment(review, changedLine(review, 'add', 'after'), keptBody)

  const twoCommentDock = page.getByRole('button', {
    name: /^(?:Preview 2 review comments|预览 2 条审查评论)$/,
  })
  await twoCommentDock.focus()
  const preview = page.getByRole('tooltip', { name: names.commentPreview })
  await expect(preview).toContainText(/left line 1|左侧第 1 行/)
  await expect(preview).toContainText(/right line 1|右侧第 1 行/)
  await expect(preview).toContainText(deletedBody)
  await expect(preview).toContainText(keptBody)

  const deletedComment = review.locator('[data-review-comment]').filter({ hasText: deletedBody })
  await deletedComment.getByRole('button', { name: /^(?:Delete|删除)$/ }).click()
  await expect(deletedComment).toHaveCount(0)

  const oneCommentDock = page.getByRole('button', { name: names.commentDock })
  await expect(oneCommentDock).toBeVisible()
  await oneCommentDock.focus()
  await expect(preview).not.toContainText(deletedBody)
  await expect(preview).toContainText(keptBody)
  await expect(review.getByRole('button', { name: keptBody, exact: true })).toBeVisible()
})
