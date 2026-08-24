/** Shared, JSON-only bridge between Host PTC logging and Turn deliverables. */

import type { ProducedFileDiff } from './change-types.ts'

export const PTC_FILE_REVIEW_SCHEMA = 2
export const PTC_FILE_REVIEW_MAX_BYTES = 256 * 1024

export type PtcFileReviewSource = 'result' | 'intent'

/** One normalized mutation reported by a tool's presentation contract. */
export interface PresentedFileChange {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  readonly source: PtcFileReviewSource
}

/** Versioned payload persisted on an invisible PTC result content block. */
export interface PtcFileReviewMarker {
  readonly schema: 1 | typeof PTC_FILE_REVIEW_SCHEMA
  readonly turn: number
  readonly step: number
  readonly rootCallId: string
  readonly subCallId: string
  readonly files: readonly PresentedFileChange[]
  readonly truncated: boolean
}

interface MarkerBlock {
  readonly type: 'text'
  readonly text: ''
  readonly dshFileReview: PtcFileReviewMarker
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function pathOf(value: unknown): string | null {
  const item = record(value)
  return item !== null && typeof item.path === 'string' && item.path !== '' ? item.path : null
}

type DiffPresentation =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'present'; readonly diffs: readonly ProducedFileDiff[] }

function diffPresentation(value: unknown): DiffPresentation {
  const view = record(value)
  if (view?.card !== 'diff') return { kind: 'absent' }
  if (!Array.isArray(view.diffs)) return { kind: 'invalid' }
  const diffs: ProducedFileDiff[] = []
  for (const candidate of view.diffs) {
    const diff = record(candidate)
    if (diff === null) return { kind: 'invalid' }
    const { path, oldText, newText, oldStart, newStart } = diff
    if (typeof path !== 'string' || path === ''
      || (oldText !== null && typeof oldText !== 'string')
      || typeof newText !== 'string'
      || (oldStart !== undefined && !positiveInteger(oldStart))
      || (newStart !== undefined && !positiveInteger(newStart))) return { kind: 'invalid' }
    diffs.push({
      path,
      oldText,
      newText,
      ...(typeof oldStart === 'number' ? { oldStart } : {}),
      ...(typeof newStart === 'number' ? { newStart } : {}),
    })
  }
  return { kind: 'present', diffs }
}

/** Strictly validate diff hunks crossing either presentation or log boundaries. */
export function presentationDiffs(value: unknown): readonly ProducedFileDiff[] {
  const parsed = diffPresentation(value)
  return parsed.kind === 'present' ? parsed.diffs : []
}

function isMutationCall(view: unknown): boolean {
  const item = record(view)
  if (item === null) return false
  if (item.card === 'diff' || (item.card === 'generic' && item.kind === 'edit')) return true
  return item.card === 'generic' && item.kind === 'delete' && locationPaths(item).length > 0
}

function locationPaths(view: unknown): readonly string[] {
  const item = record(view)
  if (item === null
    || (item.card !== 'diff'
      && !(item.card === 'generic' && (item.kind === 'edit' || item.kind === 'delete')))
    || !Array.isArray(item.locations)) return []
  return item.locations.map(pathOf).filter((path): path is string => path !== null)
}

function appendPath(paths: string[], seen: Set<string>, path: string): void {
  if (seen.has(path)) return
  seen.add(path)
  paths.push(path)
}

function resultChanges(
  diffs: readonly ProducedFileDiff[],
): readonly PresentedFileChange[] {
  const files: Array<{ path: string; diffs: ProducedFileDiff[]; source: 'result' }> = []
  const byPath = new Map<string, ProducedFileDiff[]>()
  for (const diff of diffs) {
    const existing = byPath.get(diff.path)
    if (existing !== undefined) {
      existing.push(diff)
      continue
    }
    const grouped = [diff]
    byPath.set(diff.path, grouped)
    files.push({ path: diff.path, diffs: grouped, source: 'result' })
  }
  return files
}

/**
 * Normalize tool presentation without knowing the tool name. Applied result
 * hunks win; call-time intent is the accepted fallback when they are absent.
 */
export function normalizeMutationPresentation(
  callView: unknown,
  resultView: unknown,
): readonly PresentedFileChange[] {
  if (!isMutationCall(callView)) return []
  const result = diffPresentation(resultView)
  if (result.kind === 'invalid') return []
  if (result.kind === 'present') return resultChanges(result.diffs)

  const intent = diffPresentation(callView)
  if (intent.kind === 'invalid') return []
  const intentDiffs = intent.kind === 'present' ? intent.diffs : []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const path of locationPaths(callView)) appendPath(paths, seen, path)
  for (const diff of intentDiffs) appendPath(paths, seen, diff.path)
  return paths.map(path => ({
    path,
    diffs: intentDiffs.filter(diff => diff.path === path),
    source: 'intent' as const,
  }))
}

function parseLifecycle(value: unknown): ProducedFileDiff['lifecycle'] | null {
  const lifecycle = record(value)
  if (lifecycle === null
    || (lifecycle.kind !== 'create' && lifecycle.kind !== 'delete')
    || typeof lifecycle.mode !== 'number' || !Number.isInteger(lifecycle.mode)
    || lifecycle.mode < 0 || lifecycle.mode > 0o777) return null
  return { kind: lifecycle.kind, mode: lifecycle.mode }
}

function parseDiff(
  value: unknown,
  expectedPath: string,
  schema: PtcFileReviewMarker['schema'],
): ProducedFileDiff | null {
  const item = record(value)
  if (item === null || item.path !== expectedPath) return null
  const { path, oldText, newText, oldStart, newStart, lifecycle: rawLifecycle } = item
  if (typeof path !== 'string'
    || (oldText !== null && typeof oldText !== 'string')
    || typeof newText !== 'string'
    || (oldStart !== undefined && !positiveInteger(oldStart))
    || (newStart !== undefined && !positiveInteger(newStart))) return null
  const lifecycle = rawLifecycle === undefined ? undefined : parseLifecycle(rawLifecycle)
  if ((rawLifecycle !== undefined && lifecycle === null)
    || (schema === 1 && rawLifecycle !== undefined)
    || (lifecycle?.kind === 'create' && oldText !== null)
    || (lifecycle?.kind === 'delete' && (typeof oldText !== 'string' || newText !== ''))) {
    return null
  }
  return {
    path,
    oldText,
    newText,
    ...(typeof oldStart === 'number' ? { oldStart } : {}),
    ...(typeof newStart === 'number' ? { newStart } : {}),
    ...(lifecycle !== undefined && lifecycle !== null ? { lifecycle } : {}),
  }
}

function parseFile(
  value: unknown,
  schema: PtcFileReviewMarker['schema'],
): PresentedFileChange | null {
  const item = record(value)
  if (item === null || typeof item.path !== 'string' || item.path === ''
    || (item.source !== 'result' && item.source !== 'intent')
    || !Array.isArray(item.diffs)) return null
  const diffs: ProducedFileDiff[] = []
  for (const value of item.diffs) {
    const diff = parseDiff(value, item.path, schema)
    if (diff === null) return null
    diffs.push(diff)
  }
  return { path: item.path, diffs, source: item.source }
}

/** Parse and detach one marker, optionally requiring its event correlations. */
export function parsePtcFileReviewMarker(
  value: unknown,
  expected?: { readonly rootCallId: string; readonly subCallId: string },
): PtcFileReviewMarker | null {
  const marker = record(value)
  if (marker === null || (marker.schema !== 1 && marker.schema !== PTC_FILE_REVIEW_SCHEMA)
    || typeof marker.turn !== 'number' || !Number.isInteger(marker.turn) || marker.turn < 0
    || typeof marker.step !== 'number' || !Number.isInteger(marker.step) || marker.step < 0
    || typeof marker.rootCallId !== 'string' || marker.rootCallId === ''
    || typeof marker.subCallId !== 'string' || marker.subCallId === ''
    || typeof marker.truncated !== 'boolean' || !Array.isArray(marker.files)
    || (expected !== undefined && (marker.rootCallId !== expected.rootCallId
      || marker.subCallId !== expected.subCallId))) return null
  const files: PresentedFileChange[] = []
  const seen = new Set<string>()
  for (const value of marker.files) {
    const file = parseFile(value, marker.schema)
    if (file === null || seen.has(file.path) || (marker.truncated === true && file.diffs.length > 0)) {
      return null
    }
    seen.add(file.path)
    files.push(file)
  }
  if (files.length === 0) return null
  return {
    schema: marker.schema,
    turn: marker.turn,
    step: marker.step,
    rootCallId: marker.rootCallId,
    subCallId: marker.subCallId,
    files,
    truncated: marker.truncated,
  }
}

/** Read the last valid invisible marker from one PTC settlement content array. */
export function markerFromContent(
  content: readonly unknown[],
  expected: { readonly rootCallId: string; readonly subCallId: string },
): PtcFileReviewMarker | null {
  for (let index = content.length - 1; index >= 0; index--) {
    const block = record(content[index])
    if (block?.type !== 'text' || block.text !== '') continue
    const marker = parsePtcFileReviewMarker(block.dshFileReview, expected)
    if (marker !== null) return marker
  }
  return null
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/** Bound one marker before it is duplicated into the durable PTC log. */
export function boundedPtcFileReviewMarker(
  marker: Omit<PtcFileReviewMarker, 'schema' | 'truncated'>,
  maxBytes = PTC_FILE_REVIEW_MAX_BYTES,
): PtcFileReviewMarker | null {
  const complete: PtcFileReviewMarker = {
    schema: PTC_FILE_REVIEW_SCHEMA,
    ...marker,
    truncated: false,
  }
  if (bytes(complete) <= maxBytes) return complete
  const truncated: PtcFileReviewMarker = {
    ...complete,
    files: complete.files.map(file => ({ ...file, diffs: [] })),
    truncated: true,
  }
  return bytes(truncated) <= maxBytes ? truncated : null
}

/** Build the invisible standard text block used as the durable carrier. */
export function markerBlock(marker: PtcFileReviewMarker): MarkerBlock {
  return { type: 'text', text: '', dshFileReview: marker }
}
