/** Host-side, workspace-contained undo / redo service for produced text diffs. */

import { randomUUID } from 'node:crypto'
import { link, lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  FileReviewAction,
  FileReviewChange,
  FileReviewFileResult,
  FileReviewRequest,
  FileReviewResult,
} from './change-types.ts'
import { isReversibleChange } from './file-review-change.ts'

type InspectState = Exclude<FileReviewFileResult['state'], 'error'>

interface PresentFile {
  readonly kind: 'file'
  readonly filename: string
  readonly mode: number
  readonly bytes: Uint8Array
  readonly text: string
}

interface MissingFile {
  readonly kind: 'missing'
  readonly filename: string
}

type FileImage = PresentFile | MissingFile

class FileConflictError extends Error {}

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function errorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

async function resolveFile(cwd: string, requestedPath: string): Promise<FileImage> {
  const root = await realpath(cwd)
  const candidate = resolve(root, requestedPath)
  if (!inside(root, candidate)) throw new Error('path is outside the session workspace')
  let linkStat
  try {
    linkStat = await lstat(candidate)
  } catch (error) {
    if (!errorCode(error, 'ENOENT')) throw error
    const parent = await realpath(dirname(candidate))
    if (!inside(root, parent)) throw new Error('resolved path is outside the session workspace')
    return { kind: 'missing', filename: resolve(parent, basename(candidate)) }
  }
  if (linkStat.isSymbolicLink()) throw new Error('symbolic links are not supported')
  if (!linkStat.isFile()) throw new Error('path is not a regular file')
  const filename = await realpath(candidate)
  if (!inside(root, filename)) throw new Error('resolved path is outside the session workspace')
  const bytes = await readFile(filename)
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('file is not valid UTF-8 text')
  return { kind: 'file', filename, mode: linkStat.mode & 0o777, bytes, text }
}

function offsetAtLine(text: string, line: number): number | null {
  if (!Number.isInteger(line) || line < 1) return null
  if (line === 1) return 0
  let offset = 0
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf('\n', offset)
    if (next === -1) return null
    offset = next + 1
  }
  return offset
}

function replaceHunk(
  text: string,
  source: string,
  replacement: string,
  line: number | undefined,
): string | null {
  let offset: number
  if (line !== undefined) {
    const located = offsetAtLine(text, line)
    if (located === null || text.slice(located, located + source.length) !== source) return null
    offset = located
  } else {
    if (source === '') return null
    offset = text.indexOf(source)
    if (offset === -1 || text.indexOf(source, offset + 1) !== -1) return null
  }
  return text.slice(0, offset) + replacement + text.slice(offset + source.length)
}

/** Apply a complete file's hunk sequence in memory, or report a strict mismatch. */
export function transformFile(
  text: string,
  file: FileReviewChange,
  action: FileReviewAction,
): string | null {
  if (!isReversibleChange(file) || file.diffs.some((diff) => diff.lifecycle !== undefined)) {
    return null
  }
  const diffs = action === 'undo' ? [...file.diffs].reverse() : file.diffs
  let next = text
  for (const diff of diffs) {
    const source = action === 'undo' ? diff.newText : diff.oldText
    const replacement = action === 'undo' ? diff.oldText : diff.newText
    if (source === null || replacement === null) return null
    const changed = replaceHunk(
      next,
      source,
      replacement,
      action === 'undo' ? diff.newStart : diff.oldStart,
    )
    if (changed === null) return null
    next = changed
  }
  return next
}

function virtualFile(image: FileImage, text: string, mode: number): PresentFile {
  return { kind: 'file', filename: image.filename, mode, bytes: Buffer.from(text), text }
}

function transformImage(
  image: FileImage,
  file: FileReviewChange,
  action: FileReviewAction,
): FileImage | null {
  if (!isReversibleChange(file)) return null
  const diffs = action === 'undo' ? [...file.diffs].reverse() : file.diffs
  let next = image
  for (const diff of diffs) {
    if (diff.lifecycle?.kind === 'create') {
      if (action === 'redo') {
        if (next.kind !== 'missing') return null
        next = virtualFile(next, diff.newText, diff.lifecycle.mode)
      } else {
        if (next.kind !== 'file' || next.text !== diff.newText || next.mode !== diff.lifecycle.mode)
          return null
        next = { kind: 'missing', filename: next.filename }
      }
      continue
    }
    if (diff.lifecycle?.kind === 'delete') {
      if (diff.oldText === null) return null
      if (action === 'redo') {
        if (next.kind !== 'file' || next.text !== diff.oldText || next.mode !== diff.lifecycle.mode)
          return null
        next = { kind: 'missing', filename: next.filename }
      } else {
        if (next.kind !== 'missing') return null
        next = virtualFile(next, diff.oldText, diff.lifecycle.mode)
      }
      continue
    }
    if (next.kind !== 'file' || diff.oldText === null) return null
    const source = action === 'undo' ? diff.newText : diff.oldText
    const replacement = action === 'undo' ? diff.oldText : diff.newText
    const changed = replaceHunk(
      next.text,
      source,
      replacement,
      action === 'undo' ? diff.newStart : diff.oldStart,
    )
    if (changed === null) return null
    next = virtualFile(next, changed, next.mode)
  }
  return next
}

function sameImage(left: FileImage, right: FileImage): boolean {
  return left.kind === 'missing'
    ? right.kind === 'missing'
    : right.kind === 'file' && left.text === right.text && left.mode === right.mode
}

function inspectImage(
  image: FileImage,
  file: FileReviewChange,
  requestedAction: FileReviewAction,
): { readonly state: InspectState; readonly reason?: string } {
  if (!isReversibleChange(file)) {
    return { state: 'unsupported', reason: 'change has no complete reversible diff' }
  }
  const undone = transformImage(image, file, 'undo')
  const redone = transformImage(image, file, 'redo')
  if (undone !== null && redone !== null) {
    if (sameImage(undone, image) && sameImage(redone, image)) {
      return { state: requestedAction === 'undo' ? 'applied' : 'undone' }
    }
    return { state: 'conflict', reason: 'file matches both diff directions ambiguously' }
  }
  if (undone !== null) return { state: 'applied' }
  if (redone !== null) return { state: 'undone' }
  return { state: 'conflict', reason: 'current content does not match the recorded change' }
}

async function inspectOne(
  cwd: string,
  file: FileReviewChange,
  action: FileReviewAction,
): Promise<FileReviewFileResult> {
  if (!isReversibleChange(file)) {
    return {
      path: file.path,
      state: 'unsupported',
      changed: false,
      reason: 'change has no complete reversible diff',
    }
  }
  try {
    const resolved = await resolveFile(cwd, file.path)
    const inspected = inspectImage(resolved, file, action)
    return { path: file.path, state: inspected.state, changed: false, reason: inspected.reason }
  } catch (error) {
    return {
      path: file.path,
      state: 'error',
      changed: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function assertUnchanged(image: PresentFile): Promise<void> {
  try {
    const currentStat = await lstat(image.filename)
    if (
      currentStat.isSymbolicLink() ||
      !currentStat.isFile() ||
      (currentStat.mode & 0o777) !== image.mode
    ) {
      throw new FileConflictError('file changed while the operation was being prepared')
    }
    const current = await readFile(image.filename)
    if (!Buffer.from(image.bytes).equals(current)) {
      throw new FileConflictError('file changed while the operation was being prepared')
    }
  } catch (error) {
    if (error instanceof FileConflictError) throw error
    throw new FileConflictError('file changed while the operation was being prepared')
  }
}

async function createFileAtomicExclusive(image: PresentFile): Promise<void> {
  const temp = `${image.filename}.${randomUUID()}.tmp`
  const handle = await open(temp, 'wx', image.mode)
  try {
    try {
      await handle.writeFile(image.text, 'utf8')
      // File creation modes are filtered through the process umask; reset the
      // captured permissions before linking the inode into its final name.
      await handle.chmod(image.mode)
    } finally {
      await handle.close()
    }
    try {
      await link(temp, image.filename)
    } catch (error) {
      if (errorCode(error, 'EEXIST')) {
        throw new FileConflictError('target path is no longer missing')
      }
      throw error
    }
  } finally {
    await unlink(temp).catch(() => {})
  }
}

async function replaceFileAtomicExact(current: PresentFile, target: PresentFile): Promise<void> {
  const temp = `${target.filename}.${randomUUID()}.tmp`
  const handle = await open(temp, 'wx', target.mode)
  try {
    try {
      await handle.writeFile(target.text, 'utf8')
      await handle.chmod(target.mode)
    } finally {
      await handle.close()
    }
    await assertUnchanged(current)
    await rename(temp, target.filename)
  } finally {
    await unlink(temp).catch(() => {})
  }
}

async function commitImage(current: FileImage, target: FileImage): Promise<boolean> {
  if (sameImage(current, target)) return false
  if (current.kind === 'file') await assertUnchanged(current)
  if (current.kind === 'file' && target.kind === 'missing') {
    await unlink(current.filename)
    return true
  }
  if (current.kind === 'missing' && target.kind === 'file') {
    try {
      await lstat(current.filename)
      throw new FileConflictError('target path is no longer missing')
    } catch (error) {
      if (!errorCode(error, 'ENOENT')) throw error
    }
    await createFileAtomicExclusive(target)
    return true
  }
  if (current.kind === 'file' && target.kind === 'file') {
    await replaceFileAtomicExact(current, target)
    return true
  }
  return false
}

async function applyOne(
  cwd: string,
  file: FileReviewChange,
  action: FileReviewAction,
): Promise<FileReviewFileResult> {
  if (!isReversibleChange(file)) {
    return {
      path: file.path,
      state: 'unsupported',
      changed: false,
      reason: 'change has no complete reversible diff',
    }
  }
  try {
    const resolved = await resolveFile(cwd, file.path)
    const targetState = action === 'undo' ? 'undone' : 'applied'
    const target = transformImage(resolved, file, action)
    const reverse = transformImage(resolved, file, action === 'undo' ? 'redo' : 'undo')
    if (target === null) {
      if (reverse !== null) return { path: file.path, state: targetState, changed: false }
      return {
        path: file.path,
        state: 'conflict',
        changed: false,
        reason: 'current content does not match the recorded change',
      }
    }
    if (reverse !== null && !(sameImage(target, resolved) && sameImage(reverse, resolved))) {
      return {
        path: file.path,
        state: 'conflict',
        changed: false,
        reason: 'file matches both diff directions ambiguously',
      }
    }
    const changed = await commitImage(resolved, target)
    return { path: file.path, state: targetState, changed }
  } catch (error) {
    if (error instanceof FileConflictError) {
      return { path: file.path, state: 'conflict', changed: false, reason: error.message }
    }
    return {
      path: file.path,
      state: 'error',
      changed: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function sessionCwd(agent: Agent): string {
  const cwd = agent.session.header.cwd
  if (cwd === undefined || cwd.trim() === '') throw new Error('session has no workspace directory')
  return cwd
}

/** Host service published as the `fileReview` Remote namespace. */
export class FileReviewService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'fileReview')
  }

  /** Inspect current disk state without changing files. */
  async status(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult> {
    const cwd = sessionCwd(agent)
    const files = await Promise.all(
      request.files.map((file) => inspectOne(cwd, file, request.action)),
    )
    return { files }
  }

  /** Toggle every independently safe file while the receiving Agent is idle. */
  async apply(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult> {
    const cwd = sessionCwd(agent)
    return agent.runMaintenance(async () => {
      const files: FileReviewFileResult[] = []
      for (const file of request.files) files.push(await applyOne(cwd, file, request.action))
      return { files }
    })
  }
}
