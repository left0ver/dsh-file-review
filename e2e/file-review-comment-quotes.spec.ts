/** 验证评论引用更新时保留宿主的引用文字块和用户草稿。 */

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
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const target = targetFile('comment-quotes.txt')
test.setTimeout(e2eTimeout)

async function selectQuote(source: Locator): Promise<void> {
  await source.scrollIntoViewIfNeeded()
  await source.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = document.getSelection()
    if (selection === null) throw new Error('浏览器文字选择功能不可用')
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await source
    .page()
    .getByRole('button', { name: /^(?:Quote text|引用文本)$/ })
    .click()
}

async function addComment(review: Locator, kind: 'add' | 'del', body: string): Promise<void> {
  const line = review.locator(`[data-line-kind="${kind}"]`).first()
  await line.getByRole('button', { name: /Add comment on line 1|评论第 1 行/ }).click()
  await review.getByRole('textbox', { name: /Edit comment on line 1|编辑第 1 行的评论/ }).fill(body)
  await review.getByRole('button', { name: /^(?:Save|保存)$/ }).click()
}

test('评论数量变化、清空和发送均保留引用文字块', async ({ page, agentForPage }) => {
  await prepareExistingTarget(target)
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)
  const prompt = `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`
  await sendTask(page, composer, prompt)
  const card = await waitForProducedCard(page, agent, target)

  const source = page.locator('[data-text-interaction-source]').filter({ hasText: prompt }).first()
  await selectQuote(source)
  const quote = composer.locator('[data-composer-quote]')
  await expect(quote).toHaveCount(1)
  await expect(quote).toContainText(prompt)
  const question = '请根据审查评论修改，引用文字仅作为此前任务的背景。'
  await composer.press('ControlOrMeta+End')
  await composer.pressSequentially(question)

  const review = await openReview(card, page)
  await addComment(review, 'add', '请把这一行改成 final')
  await addComment(review, 'del', '请保留文件结尾的换行')
  const chip = composer.locator('[data-composer-chip="file-review-comments"]')
  await expect(chip).toHaveCount(1)
  await expect(chip).toContainText(/2 comments|2 个评论/)
  await expect(quote).toHaveCount(1)
  await expect(quote).toContainText(prompt)
  await expect(composer).toContainText(question)

  // 在评论引用之前插入另一段引用，验证不同坐标之间的转换及评论位置恢复。
  await composer.press('ControlOrMeta+Home')
  await selectQuote(source)
  await expect(quote).toHaveCount(2)
  await expect(chip).toHaveCount(1)
  await expect
    .poll(() =>
      composer.evaluate((node) =>
        node.querySelector('p')?.firstElementChild?.getAttribute('data-composer-chip'),
      ),
    )
    .toBe('file-review-comments')

  await page.getByRole('button', { name: /Remove all review comments|移除全部审查评论/ }).click()
  await expect(chip).toHaveCount(0)
  await expect(quote).toHaveCount(2)
  await expect(composer).toContainText(question)

  await addComment(review, 'add', '请把这一行改成 final')
  await closeReview(review)
  await page.getByRole('button', { name: names.send }).click()
  await waitForProducedCard(page, agent, target, 2)
  await expectFileText(target.absolutePath, 'final\n')
  await expect(chip).toHaveCount(0)
  await expect(quote).toHaveCount(0)
  await expect(page.getByRole('button', { name: names.commentDock })).toHaveCount(0)
  await expect(page.getByRole('button', { name: names.commentHistory })).toBeVisible()
})
