/** Host-side, workspace-contained undo / redo service for produced text diffs. */

import { readFile, lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  FileReviewAction, FileReviewChange, FileReviewFileResult, FileReviewRequest, FileReviewResult,
  ProducedFileDiff,
} from './change-types.ts'

type InspectState = Exclude<FileReviewFileResult['state'], 'error'>

interface InspectedFile {
  readonly state: InspectState
  readonly text?: string | undefined
  readonly nextText?: string | undefined
  readonly reason?: string | undefined
}

interface ResolvedFile {
  readonly filename: string
  readonly mode: number
  readonly bytes: Uint8Array
  readonly text: string
}

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

async function resolveFile(cwd: string, requestedPath: string): Promise<ResolvedFile> {
  const root = await realpath(cwd)
  const candidate = resolve(root, requestedPath)
  if (!inside(root, candidate)) throw new Error('path is outside the session workspace')
  const linkStat = await lstat(candidate)
  if (linkStat.isSymbolicLink()) throw new Error('symbolic links are not supported')
  if (!linkStat.isFile()) throw new Error('path is not a regular file')
  const filename = await realpath(candidate)
  if (!inside(root, filename)) throw new Error('resolved path is outside the session workspace')
  const bytes = await readFile(filename)
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('file is not valid UTF-8 text')
  return { filename, mode: linkStat.mode & 0o777, bytes, text }
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

function hunkSupported(diff: ProducedFileDiff, path: string): boolean {
  if (diff.path !== path || diff.oldText === null || diff.oldText === diff.newText) return false
  if (diff.oldText === '' && diff.oldStart === undefined) return false
  if (diff.newText === '' && diff.newStart === undefined) return false
  return true
}

/** Apply a complete file's hunk sequence in memory, or report a strict mismatch. */
export function transformFile(
  text: string,
  file: FileReviewChange,
  action: FileReviewAction,
): string | null {
  if (file.diffs.length === 0 || !file.diffs.every(diff => hunkSupported(diff, file.path))) {
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

function inspectText(text: string, file: FileReviewChange): InspectedFile {
  if (file.diffs.length === 0 || !file.diffs.every(diff => hunkSupported(diff, file.path))) {
    return { state: 'unsupported', reason: 'change has no complete reversible diff' }
  }
  const undone = transformFile(text, file, 'undo')
  const redone = transformFile(text, file, 'redo')
  if (undone !== null && redone !== null) {
    return { state: 'conflict', reason: 'file matches both diff directions ambiguously' }
  }
  if (undone !== null) return { state: 'applied', text, nextText: undone }
  if (redone !== null) return { state: 'undone', text, nextText: redone }
  return { state: 'conflict', reason: 'current content does not match the recorded change' }
}

async function inspectOne(cwd: string, file: FileReviewChange): Promise<FileReviewFileResult> {
  if (file.diffs.length === 0 || !file.diffs.every(diff => hunkSupported(diff, file.path))) {
    return {
      path: file.path,
      state: 'unsupported',
      changed: false,
      reason: 'change has no complete reversible diff',
    }
  }
  try {
    const resolved = await resolveFile(cwd, file.path)
    const inspected = inspectText(resolved.text, file)
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

async function applyOne(
  cwd: string,
  file: FileReviewChange,
  action: FileReviewAction,
): Promise<FileReviewFileResult> {
  if (file.diffs.length === 0 || !file.diffs.every(diff => hunkSupported(diff, file.path))) {
    return {
      path: file.path,
      state: 'unsupported',
      changed: false,
      reason: 'change has no complete reversible diff',
    }
  }
  try {
    const resolved = await resolveFile(cwd, file.path)
    const inspected = inspectText(resolved.text, file)
    const sourceState = action === 'undo' ? 'applied' : 'undone'
    const targetState = action === 'undo' ? 'undone' : 'applied'
    if (inspected.state === targetState) {
      return { path: file.path, state: targetState, changed: false }
    }
    if (inspected.state !== sourceState || inspected.nextText === undefined) {
      return { path: file.path, state: inspected.state, changed: false, reason: inspected.reason }
    }

    // Re-read immediately before commit. This is the closest available CAS fence for
    // external editors that do not participate in the package's writer lock.
    const current = await readFile(resolved.filename)
    if (!Buffer.from(resolved.bytes).equals(current)) {
      return {
        path: file.path,
        state: 'conflict',
        changed: false,
        reason: 'file changed while the operation was being prepared',
      }
    }
    await writeFileAtomic(resolved.filename, inspected.nextText, { mode: resolved.mode })
    return { path: file.path, state: targetState, changed: true }
  } catch (error) {
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
    const files = await Promise.all(request.files.map(file => inspectOne(cwd, file)))
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
