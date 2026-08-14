import { useCallback, useMemo, useState } from 'react'
import { diffArrays } from 'diff'
import type { ProducedFileDiff as DiffHunk } from './turn-deliverables.ts'
import { diffContentLines } from './diff-text.ts'
import css from './UnifiedDiff.module.css'

/** Locale labels required by the review diff. */
export interface UnifiedDiffLabels {
  readonly copy: string
  readonly copied: string
  readonly showUnchanged: (count: number) => string
  readonly hideUnchanged: (count: number) => string
}

type UnifiedLineKind = 'context' | 'del' | 'add'

interface UnifiedLine {
  readonly kind: UnifiedLineKind
  readonly oldNumber: number | null
  readonly newNumber: number | null
  readonly text: string
}

interface UnifiedGap {
  readonly kind: 'gap'
  readonly id: string
  readonly lines: readonly UnifiedLine[]
}

type UnifiedRow = UnifiedLine | UnifiedGap

interface UnifiedHunk {
  readonly rows: readonly UnifiedRow[]
  readonly added: number
  readonly removed: number
  readonly unchangedBefore: number
}

interface UnifiedDiffProps {
  readonly diffs: readonly DiffHunk[]
  readonly contextLines: number
  readonly labels: UnifiedDiffLabels
  readonly className?: string | undefined
}

function hunkLines(diff: DiffHunk): UnifiedLine[] {
  const oldLines = diff.oldText === null ? [] : diffContentLines(diff.oldText)
  const newLines = diffContentLines(diff.newText)
  const changes = diffArrays(oldLines, newLines)
  const lines: UnifiedLine[] = []
  let oldNumber = diff.oldStart ?? 1
  let newNumber = diff.newStart ?? 1

  for (const change of changes) {
    if (change.removed) {
      for (const text of change.value) {
        lines.push({ kind: 'del', oldNumber, newNumber: null, text })
        oldNumber++
      }
    } else if (change.added) {
      for (const text of change.value) {
        lines.push({ kind: 'add', oldNumber: null, newNumber, text })
        newNumber++
      }
    } else {
      for (const text of change.value) {
        lines.push({ kind: 'context', oldNumber, newNumber, text })
        oldNumber++
        newNumber++
      }
    }
  }
  return lines
}

function collapsedRows(lines: readonly UnifiedLine[], contextLines: number, hunkIndex: number): UnifiedRow[] {
  const rows: UnifiedRow[] = []
  let cursor = 0
  let gapIndex = 0
  while (cursor < lines.length) {
    const current = lines[cursor]
    if (current?.kind !== 'context') {
      if (current !== undefined) rows.push(current)
      cursor++
      continue
    }

    const start = cursor
    while (cursor < lines.length && lines[cursor]?.kind === 'context') cursor++
    const run = lines.slice(start, cursor)
    const leading = start === 0
    const trailing = cursor === lines.length
    const hiddenStart = leading ? 0 : Math.min(contextLines, run.length)
    const hiddenEnd = trailing
      ? run.length
      : Math.max(hiddenStart, run.length - contextLines)

    rows.push(...run.slice(0, hiddenStart))
    const hidden = run.slice(hiddenStart, hiddenEnd)
    if (hidden.length > 0) {
      rows.push({ kind: 'gap', id: `${hunkIndex}:${gapIndex}`, lines: hidden })
      gapIndex++
    }
    rows.push(...run.slice(hiddenEnd))
  }
  return rows
}

function buildHunks(diffs: readonly DiffHunk[], contextLines: number): UnifiedHunk[] {
  let previousPath: string | undefined
  let previousOldEnd = 1
  let previousNewEnd = 1
  return diffs.map((diff, index) => {
    const lines = hunkLines(diff)
    const oldCount = lines.filter(line => line.oldNumber !== null).length
    const newCount = lines.filter(line => line.newNumber !== null).length
    const oldStart = diff.oldStart ?? 1
    const newStart = diff.newStart ?? 1
    const hasStarts = diff.oldStart !== undefined && diff.newStart !== undefined
    const unchangedBefore = hasStarts
      ? Math.max(0, Math.min(
        oldStart - (diff.path === previousPath ? previousOldEnd : 1),
        newStart - (diff.path === previousPath ? previousNewEnd : 1),
      ))
      : 0
    previousPath = diff.path
    previousOldEnd = oldStart + oldCount
    previousNewEnd = newStart + newCount
    return {
      rows: collapsedRows(lines, contextLines, index),
      added: lines.filter(line => line.kind === 'add').length,
      removed: lines.filter(line => line.kind === 'del').length,
      unchangedBefore,
    }
  })
}

function copyText(diffs: readonly DiffHunk[]): string {
  let previousPath: string | undefined
  const output: string[] = []
  for (const diff of diffs) {
    if (diff.path !== previousPath) output.push(diff.path)
    else output.push(`@@ -${diff.oldStart ?? 1} +${diff.newStart ?? 1} @@`)
    previousPath = diff.path
    for (const line of hunkLines(diff)) {
      const prefix = line.kind === 'del' ? '-' : line.kind === 'add' ? '+' : ' '
      output.push(`${prefix} ${line.text}`)
    }
  }
  return output.join('\n')
}

function lineNumbers(line: UnifiedLine): string {
  const oldNumber = line.oldNumber === null ? '' : String(line.oldNumber)
  const newNumber = line.newNumber === null ? '' : String(line.newNumber)
  return `${oldNumber}, ${newNumber}`
}

/**
 * Render line-aligned hunks with old/new gutters and expandable context gaps.
 * @param props - Unified diff data, locale labels, and presentation options.
 * @returns The line-numbered unified diff surface.
 */
export function UnifiedDiff({ diffs, contextLines, labels, className }: UnifiedDiffProps) {
  const hunks = useMemo(() => buildHunks(diffs, contextLines), [contextLines, diffs])
  const [expandedGaps, setExpandedGaps] = useState<ReadonlySet<string>>(() => new Set())
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    void navigator.clipboard?.writeText(copyText(diffs)).then(() => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    }).catch(() => {})
  }, [copied, diffs])

  if (diffs.length === 0) return null

  const totals = new Map<string, { added: number; removed: number }>()
  for (const [index, diff] of diffs.entries()) {
    const hunk = hunks[index]
    const previous = totals.get(diff.path) ?? { added: 0, removed: 0 }
    totals.set(diff.path, {
      added: previous.added + (hunk?.added ?? 0),
      removed: previous.removed + (hunk?.removed ?? 0),
    })
  }

  let previousPath: string | undefined
  return (
    <div className={`${css.unifiedBlock} ${className ?? ''}`} data-diff="" data-diff-layout="unified">
      <button type="button" className={css.unifiedCopyButton} onClick={onCopy}>
        {copied ? labels.copied : labels.copy}
      </button>
      {diffs.map((diff, hunkIndex) => {
        const firstForPath = diff.path !== previousPath
        previousPath = diff.path
        const total = totals.get(diff.path) ?? { added: 0, removed: 0 }
        const hunk = hunks[hunkIndex]
        return (
          <section key={`${diff.path}:${hunkIndex}`} className={css.unifiedFile}>
            {firstForPath
              ? (
                <header className={css.unifiedHeader}>
                  <span className={css.unifiedStatus}>M</span>
                  <span className={css.unifiedPath}>{diff.path}</span>
                  <span className={css.unifiedAdded}>+{total.added}</span>
                  <span className={css.unifiedRemoved}>-{total.removed}</span>
                </header>
              )
              : (hunk?.unchangedBefore ?? 0) === 0
                ? <div className={css.unifiedHunkHeader}>@@ -{diff.oldStart ?? 1} +{diff.newStart ?? 1} @@</div>
                : null}
            <div className={css.unifiedBody}>
              {(hunk?.unchangedBefore ?? 0) > 0 && (
                <div className={css.unifiedOmitted}>
                  <span aria-hidden="true">↕</span>
                  {labels.showUnchanged(hunk?.unchangedBefore ?? 0)}
                </div>
              )}
              {(hunk?.rows ?? []).flatMap((row) => {
                if (row.kind !== 'gap') {
                  const sign = row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : ' '
                  return [(
                    <div
                      key={`${row.kind}:${row.oldNumber ?? ''}:${row.newNumber ?? ''}`}
                      className={`${css.unifiedLine} ${css[`unified_${row.kind}`] ?? ''}`}
                      data-line-kind={row.kind}
                      data-old-line={row.oldNumber ?? undefined}
                      data-new-line={row.newNumber ?? undefined}
                    >
                      <span className={css.unifiedOldNumber}>{row.oldNumber}</span>
                      <span className={css.unifiedNewNumber}>{row.newNumber}</span>
                      <span className={css.unifiedSign}>{sign}</span>
                      <span className={css.unifiedText}>{row.text}</span>
                    </div>
                  )]
                }

                const expanded = expandedGaps.has(row.id)
                if (expanded) {
                  return [
                    <button
                      key={`${row.id}:control`}
                      type="button"
                      className={css.unifiedGap}
                      aria-expanded="true"
                      onClick={() => {
                        setExpandedGaps((current) => {
                          const next = new Set(current)
                          next.delete(row.id)
                          return next
                        })
                      }}
                    >
                      {labels.hideUnchanged(row.lines.length)}
                    </button>,
                    ...row.lines.map(line => (
                      <div
                        key={`${row.id}:${lineNumbers(line)}`}
                        className={`${css.unifiedLine} ${css.unified_context}`}
                        data-line-kind="context"
                        data-old-line={line.oldNumber ?? undefined}
                        data-new-line={line.newNumber ?? undefined}
                      >
                        <span className={css.unifiedOldNumber}>{line.oldNumber}</span>
                        <span className={css.unifiedNewNumber}>{line.newNumber}</span>
                        <span className={css.unifiedSign}> </span>
                        <span className={css.unifiedText}>{line.text}</span>
                      </div>
                    )),
                  ]
                }
                return [(
                  <button
                    key={row.id}
                    type="button"
                    className={css.unifiedGap}
                    aria-expanded="false"
                    onClick={() => {
                      setExpandedGaps(current => new Set([...current, row.id]))
                    }}
                  >
                    {labels.showUnchanged(row.lines.length)}
                  </button>
                )]
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
