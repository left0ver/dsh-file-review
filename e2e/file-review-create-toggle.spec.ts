/** 验证新建文件的审查、撤销、重新应用、权限恢复以及外部改写保护。 */

import { writeFile } from 'node:fs/promises'
import { expect } from '@playwright/test'
import { test } from './fixture.ts'
import {
  e2eTimeout,
  expectCardSummary,
  expectDiffLine,
  expectFileMode,
  expectFileText,
  expectReviewSummary,
  expectSuccessfulToggle,
  fileMode,
  names,
  openNewSession,
  openReview,
  prepareMissingTarget,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  roundTrip: targetFile('create-toggle.txt'),
  review: targetFile('create-review.txt'),
  conflict: targetFile('create-conflict.txt'),
} as const

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await Promise.all([
    prepareMissingTarget(files.roundTrip),
    prepareMissingTarget(files.review),
    prepareMissingTarget(files.conflict),
  ])
})

// 验证通过 write 工具创建的文件可从卡片撤销删除，再次应用后恢复相同内容和权限。
test('新建文件可以撤销并以原内容和权限重新应用', async ({ page, agentForPage }) => {
  const target = files.roundTrip
  await expectFileText(target.absolutePath, null)
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请使用 write 工具创建 ${target.relativePath}，文件内容必须恰好为 created 加一个换行；禁止使用 bash、shell 命令或脚本写入文件，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await expectCardSummary(card, target, 1, 0, 'undo')
  await expectFileText(target.absolutePath, 'created\n')
  const createdMode = await fileMode(target.absolutePath)

  await card.getByRole('button', { name: names.undo }).click()
  await expectSuccessfulToggle(page, 'undo')
  await expectFileText(target.absolutePath, null)
  await expect(card.getByRole('button', { name: names.reapply })).toBeEnabled()

  await card.getByRole('button', { name: names.reapply }).click()
  await expectSuccessfulToggle(page, 'reapply')
  await expectFileText(target.absolutePath, 'created\n')
  await expectFileMode(target.absolutePath, createdMode)
  await expect(card.getByRole('button', { name: names.undo })).toBeEnabled()
})

// 验证新建两行文件的审查统计为新增两行，展示准确行号且没有删除行。
test('新建多行文件的审查只包含新增行', async ({ page, agentForPage }) => {
  const target = files.review
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请使用 write 工具创建 ${target.relativePath}，内容必须恰好是两行：第一行 first-created，第二行 second-created，并保留文件末尾换行；禁止使用 bash、shell 命令或脚本写入文件，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await expectCardSummary(card, target, 2, 0)
  await expectFileText(target.absolutePath, 'first-created\nsecond-created\n')

  const review = await openReview(card, page)
  await expectReviewSummary(review, target, 2, 0)
  await expect(review.locator('[data-line-kind="del"]')).toHaveCount(0)
  await expectDiffLine(review, 'add', 1, 'first-created')
  await expectDiffLine(review, 'add', 2, 'second-created')
})

// 验证新建文件被外部改写后撤销会报告冲突，保留用户内容并继续显示撤销按钮。
test('新建文件被用户外部改写后撤销不会删除用户内容', async ({ page, agentForPage }) => {
  const target = files.conflict
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请使用 write 工具创建 ${target.relativePath}，内容必须恰好为 created 加一个换行；禁止使用 bash、shell 命令或脚本写入文件，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await expectCardSummary(card, target, 1, 0)
  await expectFileText(target.absolutePath, 'created\n')

  await writeFile(target.absolutePath, 'external user content\n')
  await card.getByRole('button', { name: names.undo }).click()

  const alert = page
    .getByRole('alert')
    .filter({ hasText: /Not all changes were restored|未还原全部更改/ })
  await expect(alert).toContainText(target.basename)
  await expectFileText(target.absolutePath, 'external user content\n')
  await expect(card.getByRole('button', { name: names.undo })).toBeEnabled()
  await expect(card.getByRole('button', { name: names.reapply })).toHaveCount(0)
})
