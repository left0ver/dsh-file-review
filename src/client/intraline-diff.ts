/**
 * Similarity-guided change-block alignment and CJK/code-aware intraline diffing.
 */

import { diffArrays } from 'diff'

export interface IntralineSegment {
  readonly text: string
  readonly changed: boolean
}

export interface IntralinePair {
  readonly oldSegments: readonly IntralineSegment[]
  readonly newSegments: readonly IntralineSegment[]
}

export interface PairedChangeRow<T> {
  readonly left?: T | undefined
  readonly right?: T | undefined
  /** True when `left` and `right` represent a paired modification candidate. */
  readonly paired: boolean
}

const MAX_INTRALINE_CHARS = 1600
const MAX_ALIGNMENT_CELLS = 2500
const ANCHOR_SIMILARITY_THRESHOLD = 0.45
const MIN_INTRALINE_SIMILARITY = 0.28

const TOKEN_PATTERN =
  /\s+|[A-Za-z0-9_$]+|[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]|[^\sA-Za-z0-9_$\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/gu

const WHITESPACE_ONLY = /^\s+$/

/** Split code and prose into identifiers, whitespace runs, individual CJK glyphs, and punctuation. */
export function tokenizeForIntraline(text: string): string[] {
  if (text.length === 0) return []
  return text.match(TOKEN_PATTERN) ?? [text]
}

/** Sørensen–Dice multiset similarity over non-whitespace tokens in [0, 1]. */
export function lineSimilarity(oldText: string, newText: string): number {
  const trimmedOld = oldText.trim()
  const trimmedNew = newText.trim()
  if (trimmedOld.length === 0 && trimmedNew.length === 0) {
    return oldText === newText ? 1 : 0
  }
  if (trimmedOld.length === 0 || trimmedNew.length === 0) return 0
  if (trimmedOld === trimmedNew) return 1
  if (trimmedOld.length + trimmedNew.length > MAX_INTRALINE_CHARS) return 0

  // Use character bigrams on trimmed lines so identifier renames (e.g. `getItem` -> `getActiveItem`)
  // and CJK edits both score smoothly without over-penalizing partial word edits.
  if (trimmedOld.length === 1 || trimmedNew.length === 1) {
    return trimmedOld === trimmedNew ? 1 : 0
  }
  const counts = new Map<string, number>()
  const oldBigrams = trimmedOld.length - 1
  const newBigrams = trimmedNew.length - 1
  for (let i = 0; i < oldBigrams; i++) {
    const gram = trimmedOld.slice(i, i + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  let intersection = 0
  for (let i = 0; i < newBigrams; i++) {
    const gram = trimmedNew.slice(i, i + 2)
    const remaining = counts.get(gram) ?? 0
    if (remaining > 0) {
      intersection++
      counts.set(gram, remaining - 1)
    }
  }
  return (2 * intersection) / (oldBigrams + newBigrams)
}

/**
 * Align a contiguous removed/added block using high-confidence similarity anchors,
 * falling back to compact positional pairing for unanchored rewrite runs.
 */
export function pairChangeBlock<T extends { readonly text: string }>(
  removed: readonly T[],
  added: readonly T[],
): PairedChangeRow<T>[] {
  const m = removed.length
  const n = added.length
  if (m === 0) return added.map((right) => ({ right, paired: false }))
  if (n === 0) return removed.map((left) => ({ left, paired: false }))
  if (m === 1 && n === 1) {
    return [{ left: removed[0], right: added[0], paired: true }]
  }

  const emitPositional = (
    leftSlice: readonly T[],
    rightSlice: readonly T[],
    target: PairedChangeRow<T>[],
  ): void => {
    const count = Math.max(leftSlice.length, rightSlice.length)
    for (let i = 0; i < count; i++) {
      const left = leftSlice[i]
      const right = rightSlice[i]
      target.push({ left, right, paired: left !== undefined && right !== undefined })
    }
  }

  if (m * n > MAX_ALIGNMENT_CELLS) {
    const fallback: PairedChangeRow<T>[] = []
    emitPositional(removed, added, fallback)
    return fallback
  }

  const cols = n + 1
  const dp = new Float64Array((m + 1) * cols)
  const choice = new Uint8Array((m + 1) * cols) // 0: skip-left, 1: skip-right, 2: match

  for (let i = m - 1; i >= 0; i--) {
    const oldText = removed[i]!.text
    for (let j = n - 1; j >= 0; j--) {
      const idx = i * cols + j
      const skipLeft = dp[(i + 1) * cols + j]!
      const skipRight = dp[i * cols + (j + 1)]!
      let best = skipLeft
      let move = 0
      if (skipRight > best) {
        best = skipRight
        move = 1
      }
      const sim = lineSimilarity(oldText, added[j]!.text)
      if (sim >= ANCHOR_SIMILARITY_THRESHOLD) {
        const score = dp[(i + 1) * cols + (j + 1)]! + sim - 0.0005 * Math.abs(i - j)
        if (score >= best) {
          best = score
          move = 2
        }
      }
      dp[idx] = best
      choice[idx] = move
    }
  }

  const anchors: Array<readonly [number, number]> = []
  let ci = 0
  let cj = 0
  while (ci < m && cj < n) {
    const move = choice[ci * cols + cj]
    if (move === 2) {
      anchors.push([ci, cj])
      ci++
      cj++
    } else if (move === 1) {
      cj++
    } else {
      ci++
    }
  }

  const rows: PairedChangeRow<T>[] = []
  let prevI = 0
  let prevJ = 0
  for (const [anchorI, anchorJ] of anchors) {
    if (anchorI > prevI || anchorJ > prevJ) {
      emitPositional(removed.slice(prevI, anchorI), added.slice(prevJ, anchorJ), rows)
    }
    rows.push({ left: removed[anchorI], right: added[anchorJ], paired: true })
    prevI = anchorI + 1
    prevJ = anchorJ + 1
  }
  if (prevI < m || prevJ < n) {
    emitPositional(removed.slice(prevI), added.slice(prevJ), rows)
  }
  return rows
}

function appendSegment(target: IntralineSegment[], text: string, changed: boolean): void {
  if (text.length === 0) return
  const previous = target.at(-1)
  if (previous !== undefined && previous.changed === changed) {
    target[target.length - 1] = { text: previous.text + text, changed }
    return
  }
  target.push({ text, changed })
}

/** Merge tiny single-space bridges between two adjacent changed spans to avoid visual confetti. */
function coalesceSegments(segments: readonly IntralineSegment[]): IntralineSegment[] {
  if (segments.length < 3) return [...segments]
  const result: IntralineSegment[] = []
  for (let i = 0; i < segments.length; i++) {
    const current = segments[i]!
    const prev = result.at(-1)
    const next = segments[i + 1]
    if (
      !current.changed &&
      prev?.changed === true &&
      next?.changed === true &&
      current.text.length <= 2 &&
      WHITESPACE_ONLY.test(current.text)
    ) {
      appendSegment(result, current.text, true)
      continue
    }
    appendSegment(result, current.text, current.changed)
  }
  return result
}

/**
 * Compute intraline changed/unchanged spans for a paired modification,
 * or return `null` when lines have no meaningful shared context.
 */
export function computeIntralineSegments(oldText: string, newText: string): IntralinePair | null {
  if (oldText === newText || oldText.length === 0 || newText.length === 0) return null
  if (oldText.length + newText.length > MAX_INTRALINE_CHARS) return null

  const similarity = lineSimilarity(oldText, newText)
  if (similarity < MIN_INTRALINE_SIMILARITY) return null

  const oldTokens = tokenizeForIntraline(oldText)
  const newTokens = tokenizeForIntraline(newText)
  const parts = diffArrays(oldTokens, newTokens)

  const rawOld: IntralineSegment[] = []
  const rawNew: IntralineSegment[] = []
  let sharedNonWhitespaceChars = 0
  let totalNonWhitespaceChars = 0

  for (const part of parts) {
    const joined = part.value.join('')
    const nonWsLength = joined.replace(/\s+/g, '').length
    if (part.removed) {
      totalNonWhitespaceChars += nonWsLength
      appendSegment(rawOld, joined, true)
    } else if (part.added) {
      totalNonWhitespaceChars += nonWsLength
      appendSegment(rawNew, joined, true)
    } else {
      sharedNonWhitespaceChars += nonWsLength
      totalNonWhitespaceChars += nonWsLength * 2
      appendSegment(rawOld, joined, false)
      appendSegment(rawNew, joined, false)
    }
  }

  // Require real shared non-whitespace tokens so unrelated lines sharing only indentation stay clean.
  if (sharedNonWhitespaceChars === 0) return null
  if (
    totalNonWhitespaceChars > 0 &&
    (2 * sharedNonWhitespaceChars) / totalNonWhitespaceChars < 0.2
  ) {
    return null
  }

  const oldSegments = coalesceSegments(rawOld)
  const newSegments = coalesceSegments(rawNew)
  const hasHighlight =
    oldSegments.some((segment) => segment.changed) || newSegments.some((segment) => segment.changed)
  return hasHighlight ? { oldSegments, newSegments } : null
}
