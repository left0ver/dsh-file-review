/** 验证安装与未安装 dsh-better-sidebar 时分别使用集成标签页和独立抽屉。 */

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
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
  reviewFileName,
  sendTask,
  targetFile,
  type TargetFile,
  waitForProducedCard,
} from './file-review-helpers.ts'

const files = {
  standalone: targetFile('review-host-standalone.txt'),
  'better-sidebar': targetFile('review-host-better-sidebar.txt'),
  sidebarMultiFirst: targetFile('review-host-sidebar-multi-first.txt'),
  sidebarMultiSecond: targetFile('review-host-sidebar-multi-second.txt'),
  sidebarComment: targetFile('review-host-sidebar-comment.txt'),
  sidebarRefresh: targetFile('review-host-sidebar-refresh.txt'),
} as const

test.setTimeout(e2eTimeout)

function requireBetterSidebar(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.metadata.reviewHost !== 'better-sidebar',
    '仅在安装 dsh-better-sidebar 的 project 中运行',
  )
}

async function openSidebarFileReview(
  card: Locator,
  page: Page,
  target: TargetFile,
): Promise<Locator> {
  await card.getByRole('button', { name: reviewFileName(target) }).click({ timeout: 15_000 })
  const review = page.locator('[data-file-review-sidebar-tab]')
  await expect(review).toBeVisible()
  await expect(page.getByRole('dialog', { name: names.reviewDialog })).toHaveCount(0)
  return review
}

async function openSidebarReview(card: Locator, page: Page): Promise<Locator> {
  await card.getByRole('button', { name: names.reviewAll }).click()
  const review = page.locator('[data-file-review-sidebar-tab]')
  await expect(review).toBeVisible()
  await expect(page.getByRole('dialog', { name: names.reviewDialog })).toHaveCount(0)
  return review
}

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

test('根据 dsh-better-sidebar 安装状态选择 Review 宿主', async ({
  page,
  agentForPage,
}, testInfo) => {
  const reviewHost = testInfo.project.metadata.reviewHost
  if (reviewHost !== 'standalone' && reviewHost !== 'better-sidebar') {
    throw new Error(`Unknown review host: ${JSON.stringify(reviewHost)}`)
  }

  const target = files[reviewHost]
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

  await card.getByRole('button', { name: names.reviewAll }).click()
  const standaloneReview = page.getByRole('dialog', { name: names.reviewDialog })
  const sidebarReview = page.locator('[data-file-review-sidebar-tab]')
  const sidebarHost = page.locator('[data-dsh-better-sidebar]')
  const review = reviewHost === 'standalone' ? standaloneReview : sidebarReview

  await expect(review).toBeVisible()
  await expectReviewSummary(review, target, 1, 1)
  await expectDiffLine(review, 'del', 1, 'before')
  await expectDiffLine(review, 'add', 1, 'after')

  if (reviewHost === 'standalone') {
    await expect(sidebarHost).toHaveCount(0)
    await expect(sidebarReview).toHaveCount(0)
  } else {
    await expect(sidebarHost).toHaveCount(1)
    await expect(standaloneReview).toHaveCount(0)
  }
})

test('dsh-better-sidebar 多文件修改后可以只审查选中的单文件', async ({
  page,
  agentForPage,
}, testInfo) => {
  requireBetterSidebar(testInfo)
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

  const review = await openSidebarFileReview(card, page, files.sidebarMultiFirst)
  await expectReviewSummary(review, files.sidebarMultiFirst, 1, 1)
  await expect(
    review.getByText(files.sidebarMultiSecond.relativePath, { exact: true }),
  ).toHaveCount(0)
  await expectDiffLine(review, 'del', 1, 'first-before')
  await expectDiffLine(review, 'add', 1, 'first-after')
})

test('dsh-better-sidebar 中的审查评论可以驱动下一轮修改', async ({
  page,
  agentForPage,
}, testInfo) => {
  requireBetterSidebar(testInfo)
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

  const firstReview = await openSidebarReview(firstCard, page)
  await expectReviewSummary(firstReview, target, 1, 1)
  await addComment(firstReview, changedLine(firstReview, 'add', 'after'), comment)

  const commentDock = page.getByRole('button', { name: names.commentDock })
  await expect(commentDock).toBeVisible()
  await sendTask(page, composer, '请严格按照审查评论修改文件，不要修改其他文件，然后结束任务。')

  const secondCard = await waitForProducedCard(page, agent, target, 2)
  await expectCardSummary(secondCard, target, 1, 1)
  await expectFileText(target.absolutePath, 'final\n')
  await expect(commentDock).toBeHidden()

  const secondReview = await openSidebarReview(secondCard, page)
  await expectReviewSummary(secondReview, target, 1, 1)
  await expectDiffLine(secondReview, 'del', 1, 'after')
  await expectDiffLine(secondReview, 'add', 1, 'final')
})

test('dsh-better-sidebar 刷新后会恢复 Review 标签页及审查目标', async ({
  page,
  agentForPage,
}, testInfo) => {
  requireBetterSidebar(testInfo)
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

  const initialReview = await openSidebarReview(card, page)
  await expectReviewSummary(initialReview, target, 1, 1)
  await expectDiffLine(initialReview, 'del', 1, 'before')
  await expectDiffLine(initialReview, 'add', 1, 'after')

  // dsh-better-sidebar debounces its per-session layout persistence by 200ms.
  await page.waitForTimeout(300)
  await page.reload()

  const restoredReview = page.locator('[data-file-review-sidebar-tab]')
  await expect(restoredReview).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('dialog', { name: names.reviewDialog })).toHaveCount(0)
  await expectReviewSummary(restoredReview, target, 1, 1)
  await expectDiffLine(restoredReview, 'del', 1, 'before')
  await expectDiffLine(restoredReview, 'add', 1, 'after')
})
