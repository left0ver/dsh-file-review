/** Shared, JSON-only bridge between Host PTC logging and Turn deliverables. */

import type { ProducedFileDiff } from './change-types.ts'

export const PTC_FILE_REVIEW_SCHEMA = 1
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
  readonly schema: typeof PTC_FILE_REVIEW_SCHEMA
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

/** Strictly validate diff hunks crossing either presentation or log boundaries. */
export function presentationDiffs(value: unknown): readonly ProducedFileDiff[] {
  const view = record(value)
  if (view?.card !== 'diff' || !Array.isArray(view.diffs)) return []
  const diffs: ProducedFileDiff[] = []
  for (const candidate of view.diffs) {
    const diff = record(candidate)
    if (diff === null) return []
    const { path, oldText, newText, oldStart, newStart } = diff
    if (typeof path !== 'string' || path === ''
      || (oldText !== null && typeof oldText !== 'string')
      || typeof newText !== 'string'
      || (oldStart !== undefined && !positiveInteger(oldStart))
      || (newStart !== undefined && !positiveInteger(newStart))) return []
    diffs.push({
      path,
      oldText,
      newText,
      ...(typeof oldStart === 'number' ? { oldStart } : {}),
      ...(typeof newStart === 'number' ? { newStart } : {}),
    })
  }
  return diffs
}

function locationPaths(view: unknown): readonly string[] {
  const item = record(view)
  if (item === null
    || (item.card !== 'diff' && !(item.card === 'generic' && item.kind === 'edit'))
    || !Array.isArray(item.locations)) return []
  return item.locations.map(pathOf).filter((path): path is string => path !== null)
}

function appendPath(paths: string[], seen: Set<string>, path: string): void {
  if (seen.has(path)) return
  seen.add(path)
  paths.push(path)
}

/**
 * Normalize tool presentation without knowing the tool name. Applied result
 * hunks win; call-time intent is the accepted fallback when they are absent.
 */
export function normalizeMutationPresentation(
  callView: unknown,
  resultView: unknown,
): readonly PresentedFileChange[] {
  const resultDiffs = presentationDiffs(resultView)
  const intentDiffs = presentationDiffs(callView)
  const paths: string[] = []
  const seen = new Set<string>()
  for (const path of locationPaths(callView)) appendPath(paths, seen, path)
  for (const diff of intentDiffs) appendPath(paths, seen, diff.path)
  for (const diff of resultDiffs) appendPath(paths, seen, diff.path)
  return paths.map((path) => {
    const applied = resultDiffs.filter(diff => diff.path === path)
    if (applied.length > 0) return { path, diffs: applied, source: 'result' as const }
    return {
      path,
      diffs: intentDiffs.filter(diff => diff.path === path),
      source: 'intent' as const,
    }
  })
}

function parseDiff(value: unknown, expectedPath: string): ProducedFileDiff | null {
  const item = record(value)
  if (item === null || item.path !== expectedPath) return null
  const { path, oldText, newText, oldStart, newStart } = item
  if (typeof path !== 'string'
    || (oldText !== null && typeof oldText !== 'string')
    || typeof newText !== 'string'
    || (oldStart !== undefined && !positiveInteger(oldStart))
    || (newStart !== undefined && !positiveInteger(newStart))) return null
  return {
    path,
    oldText,
    newText,
    ...(typeof oldStart === 'number' ? { oldStart } : {}),
    ...(typeof newStart === 'number' ? { newStart } : {}),
  }
}

function parseFile(value: unknown): PresentedFileChange | null {
  const item = record(value)
  if (item === null || typeof item.path !== 'string' || item.path === ''
    || (item.source !== 'result' && item.source !== 'intent')
    || !Array.isArray(item.diffs)) return null
  const diffs: ProducedFileDiff[] = []
  for (const value of item.diffs) {
    const diff = parseDiff(value, item.path)
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
  if (marker === null || marker.schema !== PTC_FILE_REVIEW_SCHEMA
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
    const file = parseFile(value)
    if (file === null || seen.has(file.path) || (marker.truncated === true && file.diffs.length > 0)) {
      return null
    }
    seen.add(file.path)
    files.push(file)
  }
  if (files.length === 0) return null
  return {
    schema: PTC_FILE_REVIEW_SCHEMA,
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
