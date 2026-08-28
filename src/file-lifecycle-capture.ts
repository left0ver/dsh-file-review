/** Capture exact file transitions around successful mutation tools. */

import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  PostToolDecision,
  ToolCallView,
  ToolDispatchExecution,
  ToolExecution,
  ToolExecutionResult,
  ToolExecutionToken,
} from '@deepseek-ai/dsh-tools'
import { structuredPatch, type StructuredPatchHunk } from 'diff'
import type { ProducedFileDiff } from './change-types.ts'
import type { PresentedFileChange } from './ptc-marker.ts'
import {
  boundedPtcFileReviewMarker,
  markerBlock,
  normalizeMutationPresentation,
} from './ptc-marker.ts'

interface MissingCapture {
  readonly kind: 'missing'
}

interface FileCapture {
  readonly kind: 'file'
  readonly text: string
  readonly mode: number
}

type CapturedImage = MissingCapture | FileCapture

const INLINE_UNCHANGED_LINES = 5

interface CapturedResult {
  readonly files: readonly PresentedFileChange[]
  readonly turn: number
  readonly step: number
  readonly rootCallId: string
  readonly subCallId: string
}

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

async function capturePath(root: string, path: string): Promise<CapturedImage | null> {
  const candidate = resolve(root, path)
  if (!inside(root, candidate)) return null
  let stat
  try {
    stat = await lstat(candidate)
  } catch (error) {
    return errorCode(error, 'ENOENT') ? { kind: 'missing' } : null
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return null
  const filename = await realpath(candidate)
  if (!inside(root, filename)) return null
  const bytes = await readFile(filename)
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) return null
  return { kind: 'file', text, mode: stat.mode & 0o777 }
}

function pathOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const path = (value as { path?: unknown }).path
  return typeof path === 'string' && path !== '' ? path : null
}

function mutationPaths(view: ToolCallView | undefined): readonly string[] {
  if (view === undefined) return []
  const mutation =
    view.card === 'diff' ||
    (view.card === 'generic' && (view.kind === 'edit' || view.kind === 'delete'))
  if (!mutation) return []
  const paths: string[] = []
  const seen = new Set<string>()
  const append = (path: string | null): void => {
    if (path === null || seen.has(path)) return
    seen.add(path)
    paths.push(path)
  }
  if ('locations' in view) for (const location of view.locations ?? []) append(pathOf(location))
  if (view.card === 'diff') for (const diff of view.diffs) append(pathOf(diff))
  return paths
}

function rootCall(agent: Agent, rootCallId: string): { turn: number; step: number } | null {
  const events = agent.session.events
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (
      event?.type !== 'tool/call' ||
      event.data.callId !== rootCallId ||
      !Number.isInteger(event.data.turn) ||
      event.data.turn < 0 ||
      !Number.isInteger(event.data.step) ||
      event.data.step < 0
    )
      continue
    return { turn: event.data.turn, step: event.data.step }
  }
  return null
}

async function captureImages(
  root: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, CapturedImage | null>> {
  const entries = await Promise.all(
    paths.map(async (path) => [path, await capturePath(root, path)] as const),
  )
  return new Map(entries)
}

/** Find the string offset of a one-based line, or null when that line does not exist. */
function offsetAtLine(text: string, line: number): number | null {
  let offset = 0
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf('\n', offset)
    if (next === -1) return null
    offset = next + 1
  }
  return offset
}

/** Slice an exact line range while preserving its original newline characters. */
function lineRange(text: string, start: number, count: number): string | null {
  const from = offsetAtLine(text, start)
  if (from === null) return null
  if (count === 0) return ''
  let to = from
  for (let current = 0; current < count; current += 1) {
    const next = text.indexOf('\n', to)
    if (next === -1) return current === count - 1 ? text.slice(from) : null
    to = next + 1
  }
  return text.slice(from, to)
}

type HunkRange = Pick<StructuredPatchHunk, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'>

/** Keep up to five unchanged lines inline by joining compatible neighboring hunks. */
function mergeNearbyHunks(hunks: readonly StructuredPatchHunk[]): HunkRange[] {
  const merged: HunkRange[] = []
  for (const hunk of hunks) {
    const previous = merged.at(-1)
    if (previous !== undefined) {
      const oldGap = hunk.oldStart - (previous.oldStart + previous.oldLines)
      const newGap = hunk.newStart - (previous.newStart + previous.newLines)
      if (oldGap === newGap && oldGap >= 0 && oldGap <= INLINE_UNCHANGED_LINES) {
        previous.oldLines = hunk.oldStart + hunk.oldLines - previous.oldStart
        previous.newLines = hunk.newStart + hunk.newLines - previous.newStart
        continue
      }
    }
    merged.push({
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
    })
  }
  return merged
}

/** Derive authoritative, line-addressed hunks from complete before/after file images. */
function snapshotDiffs(
  path: string,
  oldText: string,
  newText: string,
): readonly ProducedFileDiff[] {
  const patch = structuredPatch(path, path, oldText, newText, undefined, undefined, { context: 0 })
  return mergeNearbyHunks(patch.hunks).flatMap((hunk) => {
    const oldRange = lineRange(oldText, hunk.oldStart, hunk.oldLines)
    const newRange = lineRange(newText, hunk.newStart, hunk.newLines)
    return oldRange === null || newRange === null
      ? []
      : [
          {
            path,
            oldText: oldRange,
            newText: newRange,
            oldStart: hunk.oldStart,
            newStart: hunk.newStart,
          },
        ]
  })
}

/** Convert captured file images into review changes for creates, deletes, and edits. */
function snapshotFiles(
  paths: readonly string[],
  before: ReadonlyMap<string, CapturedImage | null>,
  after: ReadonlyMap<string, CapturedImage | null>,
): readonly PresentedFileChange[] {
  const files: PresentedFileChange[] = []
  for (const path of paths) {
    const oldImage = before.get(path)
    const newImage = after.get(path)
    if (oldImage?.kind === 'missing' && newImage?.kind === 'file') {
      files.push({
        path,
        source: 'result',
        diffs: [
          {
            path,
            oldText: null,
            newText: newImage.text,
            oldStart: 1,
            newStart: 1,
            lifecycle: { kind: 'create', mode: newImage.mode },
          },
        ],
      })
    } else if (oldImage?.kind === 'file' && newImage?.kind === 'missing') {
      files.push({
        path,
        source: 'result',
        diffs: [
          {
            path,
            oldText: oldImage.text,
            newText: '',
            oldStart: 1,
            newStart: 1,
            lifecycle: { kind: 'delete', mode: oldImage.mode },
          },
        ],
      })
    } else if (
      oldImage?.kind === 'file' &&
      newImage?.kind === 'file' &&
      oldImage.text !== newImage.text
    ) {
      const diffs = snapshotDiffs(path, oldImage.text, newImage.text)
      if (diffs.length > 0) files.push({ path, source: 'result', diffs })
    }
  }
  return files
}

/** Prefer snapshot-derived diffs while retaining tool presentation for uncaptured paths. */
function mergePresentedFiles(
  presented: readonly PresentedFileChange[],
  captured: readonly PresentedFileChange[],
): readonly PresentedFileChange[] {
  const replacements = new Map(captured.map((file) => [file.path, file]))
  const merged = presented.map((file) => {
    const replacement = replacements.get(file.path)
    replacements.delete(file.path)
    return replacement ?? file
  })
  return [...merged, ...replacements.values()]
}

/** Register snapshot capture without changing mutation-tool success or failure semantics. */
export function registerFileLifecycleCapture(ctx: Context): void {
  const captured = new Map<ToolExecutionToken, CapturedResult>()

  ctx.on(
    'tools/execute',
    async (exec: ToolDispatchExecution, next): Promise<ToolExecutionResult> => {
      const agent = exec.agent
      const cwd = agent?.session.header.cwd
      let paths: readonly string[] = []
      let callView: ToolCallView | undefined
      try {
        const definition = ctx.tools.get(exec.name, agent)
        callView = definition?.presentCall?.(exec.arguments)
        paths = mutationPaths(callView)
      } catch {
        paths = []
      }
      if (agent === undefined || cwd === undefined || cwd.trim() === '' || paths.length === 0) {
        return next()
      }
      let root: string
      let before: ReadonlyMap<string, CapturedImage | null>
      try {
        root = await realpath(cwd)
        before = await captureImages(root, paths)
      } catch {
        return next()
      }
      const result = await next()
      if (result.isError) return result
      try {
        const after = await captureImages(root, paths)
        const snapshots = snapshotFiles(paths, before, after)
        let presented: readonly PresentedFileChange[]
        try {
          const resultView = ctx.tools
            .get(exec.name, agent)
            ?.presentResult?.(exec.arguments, result)
          presented = normalizeMutationPresentation(callView, resultView)
        } catch {
          presented = normalizeMutationPresentation(callView, undefined)
        }
        const files = mergePresentedFiles(presented, snapshots)
        const owner = rootCall(agent, exec.rootCallId)
        if (snapshots.length > 0 && files.length > 0 && owner !== null) {
          captured.set(exec.token, {
            files,
            turn: owner.turn,
            step: owner.step,
            rootCallId: exec.rootCallId,
            subCallId: exec.callId,
          })
        }
      } catch {
        // Capturing is observational; the successful tool result stays authoritative.
      }
      return result
    },
  )

  ctx.on(
    'tools/post-execute',
    async (exec: ToolExecution, result, next): Promise<PostToolDecision> => {
      const decision = await next()
      const snapshot = captured.get(exec.token)
      captured.delete(exec.token)
      if (
        result.isError ||
        snapshot === undefined ||
        decision.kind !== 'accept' ||
        'value' in decision
      )
        return decision
      const marker = boundedPtcFileReviewMarker(snapshot)
      if (marker === null) return decision
      return {
        ...decision,
        content: [
          ...(decision.content ?? result.content),
          markerBlock(marker) as unknown as (typeof result.content)[number],
        ],
      }
    },
  )

  ctx.on('tools/result', (exec: Readonly<ToolExecution>) => {
    captured.delete(exec.token)
  })
}
