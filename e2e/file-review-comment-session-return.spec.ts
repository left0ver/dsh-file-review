/** 验证离开并返回会话后，审查评论引用仍以 chip 形式留在输入框开头并能随消息发送。 */

import { expect } from '@playwright/test'
import { test } from './fixture.ts'
import {
  closeReview,
  e2eTimeout,
  expectFileText,
  names,
  openNewSession,
  openReview,
  prepareExistingTarget,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const target = targetFile('comment-session-return.txt')

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await prepareExistingTarget(target)
})

// 验证切到新会话再返回后，评论引用没有被压平成 @review-comments 纯文本。
test('返回会话后审查评论引用仍是 chip', async ({ page, agentForPage }) => {
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  const review = await openReview(card, page)
  const addedLine = review
    .locator('[data-line-kind="add"][data-new-line="1"]')
    .filter({ hasText: 'after' })
  await addedLine.getByRole('button', { name: /Add comment on line 1|评论第 1 行/ }).click()
  await review
    .getByRole('textbox', { name: /Edit comment on line 1|编辑第 1 行的评论/ })
    .fill('返回后仍应保留')
  await review.getByRole('button', { name: /^(?:Save|保存)$/ }).click()
  await closeReview(review)

  const chip = page.locator('[data-composer-chip="file-review-comments"]')
  await expect(chip).toHaveCount(1)
  const sessions = page.getByRole('tree', { name: /^(?:Sessions|会话)$/ })
  const current = sessions.getByRole('treeitem', { selected: true })
  await expect(current).not.toHaveAccessibleName(/^(?:New Session|新会话)$/, { timeout: 60_000 })
  const rowKey = await current.getAttribute('data-row-key')
  expect(rowKey).toMatch(/^session:/)

  await page
    .getByRole('button', { name: /^(?:New session|新会话)$/ })
    .first()
    .click()
  await expect(page.getByRole('button', { name: names.commentDock })).toHaveCount(0)

  await sessions.locator(`[data-row-key="${rowKey}"]`).click()
  await expect(page.getByRole('button', { name: names.commentDock })).toBeVisible()
  const returned = page.getByRole('textbox', { name: names.composer })
  await expect(returned).toBeVisible()
  await expect(chip).toHaveCount(1)
  await expect(returned).not.toContainText('@review-comments')

  // 返回后的输入框仍能把评论发给 Agent，并在发送后清空汇总入口。
  await sendTask(page, returned, '请根据上面的审查意见，把这一行改成 final，然后结束任务。')
  await waitForProducedCard(page, agent, target, 2)
  await expectFileText(target.absolutePath, 'final\n')
  await expect(page.getByRole('button', { name: names.commentDock })).toHaveCount(0)
  await expect(page.getByText('@review-comments')).toHaveCount(0)
})
