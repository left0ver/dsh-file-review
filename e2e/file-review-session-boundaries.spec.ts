/** 验证审查评论在刷新、会话切换和历史消息投影过程中的状态边界。 */

import { expect, type Locator } from '@playwright/test'
import { test } from './fixture.ts'
import {
  closeReview,
  e2eTimeout,
  expectFileText,
  names,
  openNewSession,
  openReview,
  prepareExistingTarget,
  resolveComposer,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  reload: targetFile('comment-reload.txt'),
  isolation: targetFile('comment-isolation.txt'),
  projection: targetFile('comment-projection.txt'),
} as const

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await Promise.all([
    prepareExistingTarget(files.reload),
    prepareExistingTarget(files.isolation),
    prepareExistingTarget(files.projection),
  ])
})

async function addComment(review: Locator, body: string): Promise<void> {
  const addedLine = review
    .locator('[data-line-kind="add"][data-new-line="1"]')
    .filter({ hasText: 'after' })
  await addedLine.getByRole('button', { name: /Add comment on line 1|评论第 1 行/ }).click()
  await review.getByRole('textbox', { name: /Edit comment on line 1|编辑第 1 行的评论/ }).fill(body)
  await review.getByRole('button', { name: /^(?:Save|保存)$/ }).click()
  await expect(review.getByRole('button', { name: body, exact: true })).toBeVisible()
}

test('未提交的审查评论在页面刷新后不会残留', async ({ page, agentForPage }) => {
  const target = files.reload
  const body = '刷新后应清理的评论'
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  const review = await openReview(card, page)
  await addComment(review, body)
  await expect(page.getByRole('button', { name: names.commentDock })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: names.commentDock })).toHaveCount(0)
  const restoredCard = page.getByRole('region', { name: names.producedCard }).last()
  await expect(restoredCard).toBeVisible({ timeout: 60_000 })
  const restoredReview = await openReview(restoredCard, page)
  await expect(restoredReview.locator('[data-review-comment]')).toHaveCount(0)
  await expect(restoredReview.getByText(body, { exact: true })).toHaveCount(0)
})

test('当前会话的评论不会泄漏到新会话', async ({ page, agentForPage }) => {
  const target = files.isolation
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  const review = await openReview(card, page)
  await addComment(review, '只属于原会话的评论')
  await closeReview(review)
  await expect(page.getByRole('button', { name: names.commentDock })).toBeVisible()

  await page
    .getByRole('button', { name: /^(?:New session|新会话)$/ })
    .first()
    .click()
  await expect(await resolveComposer(page)).toBeVisible()
  await expect(page.getByRole('button', { name: names.commentDock })).toHaveCount(0)
  await expect(page.getByRole('region', { name: names.producedCard })).toHaveCount(0)
})

test('提交评论时隐藏模型引用并保留用户文字和历史评论', async ({ page, agentForPage }) => {
  const target = files.projection
  const comment = '请将这一行改成 final'
  const visibleMessage = '请根据上面的审查意见继续修改，然后结束任务。'
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const firstCard = await waitForProducedCard(page, agent, target)
  const review = await openReview(firstCard, page)
  await addComment(review, comment)
  await closeReview(review)

  await sendTask(page, composer, visibleMessage)
  await waitForProducedCard(page, agent, target, 2)
  await expectFileText(target.absolutePath, 'final\n')

  await expect(page.getByText(visibleMessage, { exact: true })).toBeVisible()
  await expect(page.getByText(/<file_review_comments>/)).toHaveCount(0)
  const historicalComment = page.getByRole('button', { name: names.commentHistory })
  await expect(historicalComment).toBeVisible()
  await historicalComment.focus()
  await expect(page.getByRole('tooltip', { name: names.commentPreview })).toContainText(comment)
})
