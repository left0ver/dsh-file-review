/** 验证新版 apply_patch 的多文件审查和文件移动恢复。 */

import { expect } from '@playwright/test'
import { test } from './fixture.ts'
import {
  closeReview,
  e2eTimeout,
  expectFileText,
  expectMultiFileCardSummary,
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

test.setTimeout(e2eTimeout)

test('apply_patch 创建、删除和移动文件后可整体撤销及重新应用', async ({ page, agentForPage }) => {
  const created = targetFile('patch-created.txt')
  const deleted = targetFile('patch-deleted.txt')
  const source = targetFile('patch-source.txt')
  const destination = targetFile('patch-destination.txt')
  await Promise.all([
    prepareMissingTarget(created),
    prepareExistingTarget(deleted, 'deleted\n'),
    prepareExistingTarget(source, 'source\n'),
    prepareMissingTarget(destination),
  ])
  const composer = await openNewSession(page, 'patch')
  const agent = await agentForPage(page)
  const patch = [
    '*** Begin Patch',
    `*** Add File: ${created.relativePath}`,
    '+created',
    `*** Delete File: ${deleted.relativePath}`,
    `*** Update File: ${source.relativePath}`,
    `*** Move to: ${destination.relativePath}`,
    '@@',
    '-source',
    '+destination',
    '*** End Patch',
  ].join('\n')
  await sendTask(
    page,
    composer,
    `请调用一次 apply_patch 工具执行以下补丁，执行成功后结束任务：\n\n${patch}`,
  )
  const card = await waitForProducedCard(page, agent, created)
  await expectMultiFileCardSummary(card, [created, deleted, source, destination], 2, 2)
  await expectFileText(created.absolutePath, 'created\n')
  await expectFileText(deleted.absolutePath, null)
  await expectFileText(source.absolutePath, null)
  await expectFileText(destination.absolutePath, 'destination\n')
  const review = await openReview(card, page)
  await expect(review.getByText(destination.relativePath, { exact: true })).toBeVisible()
  await closeReview(review)
  await card.getByRole('button', { name: names.undo }).click()
  await expectSuccessfulToggle(page, 'undo')
  await expectFileText(created.absolutePath, null)
  await expectFileText(deleted.absolutePath, 'deleted\n')
  await expectFileText(source.absolutePath, 'source\n')
  await expectFileText(destination.absolutePath, null)
  await card.getByRole('button', { name: names.reapply }).click()
  await expectSuccessfulToggle(page, 'reapply')
  await expectFileText(created.absolutePath, 'created\n')
  await expectFileText(deleted.absolutePath, null)
  await expectFileText(source.absolutePath, null)
  await expectFileText(destination.absolutePath, 'destination\n')
})
