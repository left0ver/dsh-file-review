/** 验证撤销或重新应用遇到外部文件冲突时不会覆盖用户内容，并可处理部分成功。 */

import { writeFile } from 'node:fs/promises'
import { expect, type Locator, type Page } from '@playwright/test'
import { test } from './fixture.ts'
import {
  e2eTimeout,
  expectCardSummary,
  expectFileText,
  expectMultiFileCardSummary,
  expectSuccessfulToggle,
  names,
  openNewSession,
  prepareExistingTarget,
  sendTask,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  undo: targetFile('conflict-protection.txt'),
  reapply: targetFile('conflict-reapply.txt'),
  mixedFirst: targetFile('conflict-mixed-first.txt'),
  mixedSecond: targetFile('conflict-mixed-second.txt'),
} as const

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await Promise.all([
    prepareExistingTarget(files.undo),
    prepareExistingTarget(files.reapply),
    prepareExistingTarget(files.mixedFirst, 'first-before\n'),
    prepareExistingTarget(files.mixedSecond, 'second-before\n'),
  ])
})

async function expectPartialAlert(
  page: Page,
  action: 'undo' | 'reapply',
  target: { readonly basename: string },
): Promise<Locator> {
  const title =
    action === 'undo'
      ? /Not all changes were restored|未还原全部更改/
      : /Not all changes were reapplied|未重新应用全部更改/
  const description =
    action === 'undo'
      ? /An error occurred while restoring some files|还原部分文件时出错/
      : /An error occurred while reapplying some files|重新应用部分文件时出错/
  const alert = page.getByRole('alert').filter({ hasText: title })
  await expect(alert).toBeVisible()
  await expect(alert).toContainText(description)
  await expect(alert).toContainText(target.basename)
  await expect(alert.getByRole('button').filter({ hasText: target.basename })).toBeVisible()
  return alert
}

test('文件发生外部冲突时撤销不会覆盖用户内容', async ({ page, agentForPage }) => {
  const target = files.undo
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

  await writeFile(target.absolutePath, 'external user change\n')
  await card.getByRole('button', { name: names.undo }).click()

  await expectPartialAlert(page, 'undo', target)

  await expectFileText(target.absolutePath, 'external user change\n')
  await expect(card.getByRole('button', { name: names.undo })).toBeEnabled()
  await expect(card.getByRole('button', { name: names.reapply })).toHaveCount(0)
})

test('撤销后发生外部冲突时重新应用不会覆盖用户内容', async ({ page, agentForPage }) => {
  const target = files.reapply
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${target.relativePath} 中的 before 修改成 after，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await card.getByRole('button', { name: names.undo }).click()
  await expectSuccessfulToggle(page, 'undo')
  await expectFileText(target.absolutePath, 'before\n')

  await writeFile(target.absolutePath, 'external change after undo\n')
  await card.getByRole('button', { name: names.reapply }).click()
  await expectPartialAlert(page, 'reapply', target)

  await expectFileText(target.absolutePath, 'external change after undo\n')
  await expect(card.getByRole('button', { name: names.reapply })).toBeEnabled()
  await expect(card.getByRole('button', { name: names.undo })).toHaveCount(0)
})

test('双文件撤销只跳过冲突文件并恢复安全文件', async ({ page, agentForPage }) => {
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只修改两个文件：把 ${files.mixedFirst.relativePath} 的 first-before 改成 first-after，把 ${files.mixedSecond.relativePath} 的 second-before 改成 second-after；不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, files.mixedFirst)
  await expectMultiFileCardSummary(card, [files.mixedFirst, files.mixedSecond], 2, 2)
  await expectFileText(files.mixedFirst.absolutePath, 'first-after\n')
  await expectFileText(files.mixedSecond.absolutePath, 'second-after\n')

  await writeFile(files.mixedFirst.absolutePath, 'external mixed change\n')
  await card.getByRole('button', { name: names.undo }).click()
  const alert = await expectPartialAlert(page, 'undo', files.mixedFirst)

  await expect(alert).not.toContainText(files.mixedSecond.basename)
  await expectFileText(files.mixedFirst.absolutePath, 'external mixed change\n')
  await expectFileText(files.mixedSecond.absolutePath, 'second-before\n')
  await expect(card.getByRole('button', { name: names.undo })).toBeEnabled()
})
