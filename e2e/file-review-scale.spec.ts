/** 验证多文件折叠、同文件多处修改统计以及跨轮次 Review 抽屉切换。 */

import { expect } from '@playwright/test'
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
  statsName,
  targetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const overflowFiles = Array.from({ length: 7 }, (_, index) =>
  targetFile(`overflow-${index + 1}.txt`),
)
const files = {
  multiHunk: targetFile('multi-hunk.txt'),
  firstTurn: targetFile('cross-turn-first.txt'),
  secondTurn: targetFile('cross-turn-second.txt'),
} as const

test.setTimeout(e2eTimeout)

test.beforeEach(async () => {
  await Promise.all([
    ...overflowFiles.map((target, index) => prepareExistingTarget(target, `before-${index + 1}\n`)),
    prepareExistingTarget(files.multiHunk, 'top-before\nmiddle-stays\nbottom-before\n'),
    prepareExistingTarget(files.firstTurn, 'first-before\n'),
    prepareExistingTarget(files.secondTurn, 'second-before\n'),
  ])
})

test('七文件卡片先显示六项并可展开剩余文件', async ({ page, agentForPage }) => {
  const composer = await openNewSession(page, 'code')
  const agent = await agentForPage(page)
  const changes = overflowFiles
    .map((target, index) => `${target.relativePath} 的 before-${index + 1} 改成 after-${index + 1}`)
    .join('；')

  await sendTask(
    page,
    composer,
    `请只修改以下七个文件并保留各自末尾换行：${changes}；不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, overflowFiles[0]!)

  await expect(card.getByText(/^(?:Edited 7 files|已编辑 7 个文件)$/)).toBeVisible()
  await expect(card.getByLabel(statsName(7, 7))).toHaveCount(1)
  for (const target of overflowFiles.slice(0, 6)) {
    await expect(card.getByText(target.basename, { exact: true })).toBeVisible()
  }
  await expect(card.getByText(overflowFiles[6]!.basename, { exact: true })).toHaveCount(0)
  await expect(card.getByLabel(statsName(1, 1))).toHaveCount(6)

  await card.getByRole('button', { name: /^(?:1 more file|另有 1 个文件)$/ }).click()
  for (const [index, target] of overflowFiles.entries()) {
    await expect(card.getByText(target.basename, { exact: true })).toBeVisible()
    await expectFileText(target.absolutePath, `after-${index + 1}\n`)
  }
  await expect(card.getByLabel(statsName(1, 1))).toHaveCount(7)
})

test('同一文件的两处修改会合并统计并保留各自行号', async ({ page, agentForPage }) => {
  const target = files.multiHunk
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只修改 ${target.relativePath}：第 1 行 top-before 改成 top-after，第 3 行 bottom-before 改成 bottom-after；保留第 2 行和末尾换行，不要修改其他文件，然后结束任务。`,
  )
  const card = await waitForProducedCard(page, agent, target)
  await expectCardSummary(card, target, 2, 2)
  await expectFileText(target.absolutePath, 'top-after\nmiddle-stays\nbottom-after\n')

  const review = await openReview(card, page)
  await expectReviewSummary(review, target, 2, 2)
  await expectDiffLine(review, 'del', 1, 'top-before')
  await expectDiffLine(review, 'add', 1, 'top-after')
  await expectDiffLine(review, 'del', 3, 'bottom-before')
  await expectDiffLine(review, 'add', 3, 'bottom-after')
})

test('跨轮次打开 Review 时抽屉切换到最新卡片', async ({ page, agentForPage }) => {
  const composer = await openNewSession(page, 'standard')
  const agent = await agentForPage(page)

  await sendTask(
    page,
    composer,
    `请只把 ${files.firstTurn.relativePath} 的 first-before 改成 first-after，不要修改其他文件，然后结束任务。`,
  )
  await waitForProducedCard(page, agent, files.firstTurn)
  await sendTask(
    page,
    composer,
    `请只把 ${files.secondTurn.relativePath} 的 second-before 改成 second-after，不要修改其他文件，然后结束任务。`,
  )
  await waitForProducedCard(page, agent, files.secondTurn, 2)

  const cards = page.getByRole('region', { name: names.producedCard })
  const firstReview = await openReview(cards.nth(0), page)
  await expectReviewSummary(firstReview, files.firstTurn, 1, 1)

  await cards.nth(1).getByRole('button', { name: names.reviewAll }).click()
  const transferredReview = page.getByRole('dialog', { name: names.reviewDialog })
  await expectReviewSummary(transferredReview, files.secondTurn, 1, 1)
  await expect(
    transferredReview.getByText(files.firstTurn.relativePath, { exact: true }),
  ).toHaveCount(0)
  await expectDiffLine(transferredReview, 'del', 1, 'second-before')
  await expectDiffLine(transferredReview, 'add', 1, 'second-after')
  await closeReview(transferredReview)
  await expect(cards.nth(1).getByRole('button', { name: names.reviewAll })).toBeFocused()
})
