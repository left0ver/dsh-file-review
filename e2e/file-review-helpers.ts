import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PlayWrightAiFixtureType } from '@midscene/web/playwright'
import { expect, type Locator, type Page } from '@playwright/test'

const root = process.cwd()
const workspace = process.env.E2E_WORKSPACE ?? path.resolve('.e2e/workspace')
const workspaceRelativePath = path.relative(root, workspace).split(path.sep).join('/')

export const e2eTimeout = 7 * 60_000

export interface TargetFile {
  readonly absolutePath: string
  readonly relativePath: string
  readonly basename: string
}

export type MidsceneAgent = Awaited<ReturnType<PlayWrightAiFixtureType['agentForPage']>>
export type AgentPreset = 'standard' | 'code'

export const names = {
  close: /^(?:Close|关闭)$/,
  commentDock: /^(?:Preview 1 review comments|预览 1 条审查评论)$/,
  commentHistory: /^(?:1 comment|1 个评论)$/,
  commentPreview: /^(?:Review comment preview|审查评论预览)$/,
  composer:
    /Describe what you want to build|描述你想(?:要)?构建的内容|Message the agent|给智能体发消息|Message or run a task|发送消息或运行任务/,
  producedCard: /^(?:Edited files|已编辑文件)$/,
  reapply: /^(?:Reapply|重新应用)$/,
  reviewAll: /^(?:Review all produced files|审查所有产出文件)$/,
  reviewDialog: /^(?:Review|审查)$/,
  send: /^(?:Send message|发送消息)$/,
  undo: /^(?:Undo|撤销)$/,
} as const

const presetLabels: Record<AgentPreset, RegExp> = {
  standard: /^(?:Standard mode|标准模式)$/,
  code: /^(?:PTC mode|PTC 模式)$/,
}

const anyBuiltInPreset =
  /Standard mode|标准模式|PTC mode|PTC 模式|Creator mode|创造模式|Minimal mode|极简模式/

export function targetFile(basename: string): TargetFile {
  return {
    absolutePath: path.join(workspace, basename),
    relativePath: path.posix.join(workspaceRelativePath, basename),
    basename,
  }
}

export async function prepareExistingTarget(
  target: TargetFile,
  content = 'before\n',
): Promise<void> {
  await mkdir(workspace, { recursive: true })
  await writeFile(target.absolutePath, content)
}

export async function prepareMissingTarget(target: TargetFile): Promise<void> {
  await mkdir(workspace, { recursive: true })
  await rm(target.absolutePath, { force: true })
}

async function readTextOrMissing(filename: string): Promise<string | null> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function readModeOrMissing(filename: string): Promise<number | null> {
  try {
    return (await stat(filename)).mode & 0o777
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function expectFileText(filename: string, expected: string | null): Promise<void> {
  await expect.poll(() => readTextOrMissing(filename), { timeout: 15_000 }).toBe(expected)
}

export async function fileMode(filename: string): Promise<number> {
  return (await stat(filename)).mode & 0o777
}

export async function expectFileMode(filename: string, expected: number): Promise<void> {
  await expect.poll(() => readModeOrMissing(filename), { timeout: 15_000 }).toBe(expected)
}

function presetButton(page: Page): Locator {
  return page.locator('button[aria-haspopup="menu"]').filter({ hasText: anyBuiltInPreset }).first()
}

export async function expectSelectedPreset(page: Page, preset: AgentPreset): Promise<void> {
  await expect(presetButton(page)).toContainText(presetLabels[preset])
}

export async function openNewSession(page: Page, preset: AgentPreset): Promise<Locator> {
  await page.goto('/')

  const composer = page.getByRole('textbox', { name: names.composer })
  const welcomeDialog = page.getByRole('dialog', {
    name: /^(?:Internal Testing Notice|内测声明)$/,
  })
  const continueWelcome = welcomeDialog.getByRole('button', {
    name: /^(?:Continue|继续)$/,
  })

  await expect(composer.or(continueWelcome).first()).toBeVisible()
  if (await continueWelcome.isVisible()) await continueWelcome.click()
  await expect(composer).toBeVisible()

  const picker = presetButton(page)
  await expect(picker).toBeVisible()
  const wanted = presetLabels[preset]
  if (!wanted.test(await picker.innerText())) {
    await picker.click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await menu.getByText(wanted).click()
  }
  await expectSelectedPreset(page, preset)

  return composer
}

export async function sendTask(page: Page, composer: Locator, prompt: string): Promise<void> {
  await composer.press('End')
  await page.keyboard.insertText(prompt)
  await page.getByRole('button', { name: names.send }).click()
}

export async function waitForProducedCard(
  page: Page,
  agent: MidsceneAgent,
  expectedFile: TargetFile,
  expectedCardCount = 1,
): Promise<Locator> {
  const cards = page.getByRole('region', { name: names.producedCard })
  if (expectedCardCount === 1) {
    await agent.aiWaitFor(
      `Agent 已结束运行，并且聊天中已经出现“已编辑文件”卡片；卡片包含 ${expectedFile.basename}`,
      { timeoutMs: 180_000 },
    )
  }
  await expect(cards).toHaveCount(expectedCardCount, { timeout: 180_000 })
  const card = cards.last()
  await expect(card).toBeVisible()
  await expect(card).toContainText(expectedFile.basename)
  return card
}

export function statsName(added: number, removed: number): RegExp {
  return new RegExp(
    `^(?:${added} lines added, ${removed} lines removed|新增 ${added} 行，删除 ${removed} 行)$`,
  )
}

function editedFileCountName(count: number): RegExp {
  return count === 1
    ? /^(?:Edited 1 file|已编辑 1 个文件)$/
    : new RegExp(`^(?:Edited ${count} files|已编辑 ${count} 个文件)$`)
}

function reviewFileCountName(count: number): RegExp {
  return count === 1 ? /^(?:1 file|1 个文件)$/ : new RegExp(`^(?:${count} files|${count} 个文件)$`)
}

export async function expectCardSummary(
  card: Locator,
  expectedFile: TargetFile,
  added: number,
  removed: number,
  toggle: 'undo' | 'reapply' = 'undo',
): Promise<void> {
  await expect(card.getByText(editedFileCountName(1))).toBeVisible()
  await expect(card.getByText(expectedFile.basename, { exact: true })).toBeVisible()
  await expect(card.getByLabel(statsName(added, removed))).toHaveCount(2)
  await expect(card.getByRole('button', { name: names.reviewAll })).toBeEnabled()
  await expect(card.getByRole('button', { name: names[toggle] })).toBeEnabled()
}

export async function expectMultiFileCardSummary(
  card: Locator,
  expectedFiles: readonly TargetFile[],
  added: number,
  removed: number,
  toggle: 'undo' | 'reapply' = 'undo',
): Promise<void> {
  await expect(card.getByText(editedFileCountName(expectedFiles.length))).toBeVisible()
  for (const expectedFile of expectedFiles) {
    await expect(card.getByText(expectedFile.basename, { exact: true })).toBeVisible()
  }
  await expect(card.getByLabel(statsName(added, removed))).toHaveCount(1)
  await expect(card.getByRole('button', { name: names.reviewAll })).toBeEnabled()
  await expect(card.getByRole('button', { name: names[toggle] })).toBeEnabled()
}

export async function openReview(card: Locator, page: Page): Promise<Locator> {
  await card.getByRole('button', { name: names.reviewAll }).click()
  const dialog = page.getByRole('dialog', { name: names.reviewDialog })
  await expect(dialog).toBeVisible()
  return dialog
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function reviewFileName(expectedFile: TargetFile): RegExp {
  return new RegExp(
    String.raw`^(?:Review|审查) (?:.*[\\/])?${escapeRegExp(expectedFile.basename)}$`,
  )
}

export async function openFileReview(
  card: Locator,
  page: Page,
  expectedFile: TargetFile,
): Promise<Locator> {
  await card.getByRole('button', { name: reviewFileName(expectedFile) }).click()
  const dialog = page.getByRole('dialog', { name: names.reviewDialog })
  await expect(dialog).toBeVisible()
  return dialog
}

export async function closeReview(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: names.close }).click()
  await expect(dialog).toBeHidden()
}

export async function expectReviewSummary(
  dialog: Locator,
  expectedFile: TargetFile,
  added: number,
  removed: number,
): Promise<void> {
  await expect(dialog.getByText(reviewFileCountName(1))).toBeVisible()
  await expect(dialog.getByText(expectedFile.relativePath, { exact: true })).toBeVisible()
  await expect(dialog.getByLabel(statsName(added, removed))).toHaveCount(2)
}

export async function expectMultiFileReviewSummary(
  dialog: Locator,
  expectedFiles: readonly TargetFile[],
  added: number,
  removed: number,
): Promise<void> {
  await expect(dialog.getByText(reviewFileCountName(expectedFiles.length))).toBeVisible()
  for (const expectedFile of expectedFiles) {
    await expect(dialog.getByText(expectedFile.relativePath, { exact: true })).toBeVisible()
  }
  await expect(dialog.getByLabel(statsName(added, removed))).toHaveCount(1)
}

export async function expectDiffLine(
  dialog: Locator,
  kind: 'del' | 'add',
  line: number,
  text: string,
): Promise<void> {
  const lineAttribute = kind === 'del' ? 'data-old-line' : 'data-new-line'
  const diffLine = dialog
    .locator(`[data-line-kind="${kind}"][${lineAttribute}="${line}"]`)
    .filter({ hasText: text })
  await expect(diffLine).toBeVisible()
  await expect(diffLine).toContainText(text)
}

export async function expectSuccessfulToggle(
  page: Page,
  action: 'undo' | 'reapply',
): Promise<Locator> {
  const title =
    action === 'undo' ? /Changes undone|已成功撤销更改/ : /Changes reapplied|已成功重新应用更改/
  const alert = page.getByRole('alert').filter({ hasText: title }).last()
  await expect(alert).toBeVisible()
  return alert
}
