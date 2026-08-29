/** 验证审查评论编辑器通过 Enter、Shift+Enter 和 Escape 完成保存、换行与取消。 */

import { expect, type Locator } from '@playwright/test'
import { test } from './fixture.ts'
import {
  e2eTimeout,
  names,
  openNewSession,
  openReview,
  prepareExistingTarget,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  enter: targetFile('comment-enter.txt'),
  multiline: targetFile('comment-multiline.txt'),
  escape: targetFile('comment-escape.txt'),
} as const

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await Promise.all([
    prepareExistingTarget(files.enter),
    prepareExistingTarget(files.multiline),
    prepareExistingTarget(files.escape),
  ])
})

function addedLine(review: Locator): Locator {
  return review.locator('[data-line-kind="add"][data-new-line="1"]').filter({ hasText: 'after' })
}

async function startComment(review: Locator): Promise<Locator> {
  await addedLine(review)
    .getByRole('button', { name: /Add comment on line 1|评论第 1 行/ })
    .click()
  return review.getByRole('textbox', {
    name: /Edit comment on line 1|编辑第 1 行的评论/,
  })
}

test('评论编辑器按 Enter 直接保存', async ({ page, agentForPage }) => {
  const target = files.enter
  const body = 'Enter 保存的评论'
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  const review = await openReview(card, page)
  const editor = await startComment(review)
  await editor.fill(body)
  await editor.press('Enter')

  await expect(editor).toBeHidden()
  await expect(review.getByRole('button', { name: body, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: names.commentDock })).toBeVisible()
})

test('Shift+Enter 在评论中保留换行且不会提前保存', async ({ page, agentForPage }) => {
  const target = files.multiline
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  const review = await openReview(card, page)
  const editor = await startComment(review)
  await editor.fill('第一行反馈')
  await editor.press('Shift+Enter')
  await editor.type('第二行反馈')

  await expect(editor).toHaveValue('第一行反馈\n第二行反馈')
  await expect(page.getByRole('button', { name: names.commentDock })).toHaveCount(0)
  await review.getByRole('button', { name: /^(?:Save|保存)$/ }).click()

  const dock = page.getByRole('button', { name: names.commentDock })
  await dock.focus()
  const preview = page.getByRole('tooltip', { name: names.commentPreview })
  await expect(preview).toContainText('第一行反馈')
  await expect(preview).toContainText('第二行反馈')
})

test('Escape 取消评论并关闭 Review 且不会改变已保存内容', async ({ page, agentForPage }) => {
  const target = files.escape
  const savedBody = '保持这条已保存评论'
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  let review = await openReview(card, page)

  let editor = await startComment(review)
  await editor.fill('不应保存的新草稿')
  await editor.press('Escape')
  await expect(review).toBeHidden()
  await expect(page.getByRole('button', { name: names.commentDock })).toHaveCount(0)

  review = await openReview(card, page)
  await expect(review.locator('[data-review-comment]')).toHaveCount(0)
  editor = await startComment(review)
  await editor.fill(savedBody)
  await editor.press('Enter')
  await review.getByRole('button', { name: savedBody, exact: true }).click()
  editor = review.getByRole('textbox', {
    name: /Edit comment on line 1|编辑第 1 行的评论/,
  })
  await editor.fill('不应覆盖的编辑草稿')
  await editor.press('Escape')

  await expect(review).toBeHidden()
  review = await openReview(card, page)
  await expect(review.getByRole('button', { name: savedBody, exact: true })).toBeVisible()
  await expect(review.getByText('不应覆盖的编辑草稿', { exact: true })).toHaveCount(0)
  const dock = page.getByRole('button', { name: names.commentDock })
  await dock.focus()
  await expect(page.getByRole('tooltip', { name: names.commentPreview })).toContainText(savedBody)
})
