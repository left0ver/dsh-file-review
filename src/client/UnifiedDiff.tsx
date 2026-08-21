import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { diffArrays } from 'diff'
import type { ProducedFileDiff as DiffHunk } from './turn-deliverables.ts'
import { diffContentLines } from './diff-text.ts'
import type { DiffLineAnchor } from './review-comments.ts'
import css from './UnifiedDiff.module.css'

export type { DiffLineAnchor } from './review-comments.ts'

/** Locale labels required by the review diff. */
export interface UnifiedDiffLabels {
  readonly copy: string
  readonly copied: string
  readonly showUnchanged: (count: number) => string
  readonly hideUnchanged: (count: number) => string
  readonly addComment?: (line: number) => string
  readonly editComment?: (line: number) => string
  readonly commentPlaceholder?: string
  readonly commentNewlineHint?: string
  readonly cancelComment?: string
  readonly saveComment?: string
  readonly deleteComment?: string
}

/** Added and removed line totals derived from the same hunks the viewer renders. */
export interface UnifiedDiffStats {
  readonly added: number
  readonly removed: number
}

type UnifiedLineKind = 'context' | 'del' | 'add'

interface UnifiedLine {
  readonly rowIndex: number
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
  readonly lines: readonly UnifiedLine[]
  readonly rows: readonly UnifiedRow[]
  readonly added: number
  readonly removed: number
  readonly unchangedBefore: number
}

const COMMENT_EDITOR_MIN_HEIGHT = 52
const COMMENT_EDITOR_MAX_HEIGHT = 176

interface CommentEditorProps {
  readonly ariaLabel: string
  readonly placeholder?: string | undefined
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onCommit: () => void
  readonly onCancel: () => void
}

/** Grow with the draft until the shared saved/editing height cap, then scroll. */
function CommentEditor({
  ariaLabel, placeholder, value, onChange, onCommit, onCancel,
}: CommentEditorProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (editor === null) return
    editor.style.height = 'auto'
    const contentHeight = Math.max(COMMENT_EDITOR_MIN_HEIGHT, editor.scrollHeight)
    editor.style.height = `${Math.min(contentHeight, COMMENT_EDITOR_MAX_HEIGHT)}px`
    editor.style.overflowY = contentHeight > COMMENT_EDITOR_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [value])

  return (
    <textarea
      ref={editorRef}
      autoFocus
      className={css.commentEditor}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={event => { onChange(event.currentTarget.value) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          if (value.trim() !== '') onCommit()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    />
  )
}

export interface UnifiedDiffProps {
  readonly diffs: readonly DiffHunk[]
  readonly contextLines: number
  readonly labels: UnifiedDiffLabels
  readonly className?: string | undefined
  readonly showCopyButton?: boolean | undefined
  readonly showFileHeaders?: boolean | undefined
  readonly commentFor?: ((anchor: DiffLineAnchor) => string | undefined) | undefined
  readonly onCommentChange?: ((anchor: DiffLineAnchor, body: string) => void) | undefined
  readonly onCommentDelete?: ((anchor: DiffLineAnchor) => void) | undefined
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
        lines.push({ rowIndex: lines.length, kind: 'del', oldNumber, newNumber: null, text })
        oldNumber++
      }
    } else if (change.added) {
      for (const text of change.value) {
        lines.push({ rowIndex: lines.length, kind: 'add', oldNumber: null, newNumber, text })
        newNumber++
      }
    } else {
      for (const text of change.value) {
        lines.push({ rowIndex: lines.length, kind: 'context', oldNumber, newNumber, text })
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
      lines,
      rows: collapsedRows(lines, contextLines, index),
      added: lines.filter(line => line.kind === 'add').length,
      removed: lines.filter(line => line.kind === 'del').length,
      unchangedBefore,
    }
  })
}

/** Serialize recorded hunks as one plain-text unified diff. */
export function unifiedDiffText(diffs: readonly DiffHunk[]): string {
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

/** Count added and removed lines using the viewer's exact line-diff algorithm. */
export function summarizeDiffs(diffs: readonly DiffHunk[]): UnifiedDiffStats {
  let added = 0
  let removed = 0
  for (const diff of diffs) {
    for (const line of hunkLines(diff)) {
      if (line.kind === 'add') added++
      if (line.kind === 'del') removed++
    }
  }
  return { added, removed }
}

function lineNumbers(line: UnifiedLine): string {
  const oldNumber = line.oldNumber === null ? '' : String(line.oldNumber)
  const newNumber = line.newNumber === null ? '' : String(line.newNumber)
  return `${oldNumber}, ${newNumber}`
}

function lineNumber(line: UnifiedLine): number | null {
  return line.kind === 'del' ? line.oldNumber : line.newNumber
}

function excerptFor(lines: readonly UnifiedLine[], target: UnifiedLine): string {
  const start = Math.max(0, target.rowIndex - 3)
  const end = Math.min(lines.length, target.rowIndex + 4)
  return lines.slice(start, end).map((line) => {
    const prefix = line.kind === 'del' ? '-' : line.kind === 'add' ? '+' : ' '
    return `${prefix} ${line.text}`
  }).join('\n')
}

function anchorFor(
  diff: DiffHunk,
  hunk: UnifiedHunk,
  hunkIndex: number,
  line: UnifiedLine,
): DiffLineAnchor {
  return {
    path: diff.path,
    hunkIndex,
    rowIndex: line.rowIndex,
    kind: line.kind,
    oldLine: line.oldNumber,
    newLine: line.newNumber,
    text: line.text,
    excerpt: excerptFor(hunk.lines, line),
  }
}

/**
 * Render line-aligned hunks with a single gutter and expandable context gaps.
 * @param props - Unified diff data, locale labels, and presentation options.
 * @returns The line-numbered unified diff surface.
 */
export function UnifiedDiff({
  diffs,
  contextLines,
  labels,
  className,
  showCopyButton = true,
  showFileHeaders = true,
  commentFor,
  onCommentChange,
  onCommentDelete,
}: UnifiedDiffProps) {
  const hunks = useMemo(() => buildHunks(diffs, contextLines), [contextLines, diffs])
  const [expandedGaps, setExpandedGaps] = useState<ReadonlySet<string>>(() => new Set())
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')

  const onCopy = useCallback(() => {
    if (copied) return
    void navigator.clipboard?.writeText(unifiedDiffText(diffs)).then(() => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    }).catch(() => {})
  }, [copied, diffs])

  if (diffs.length === 0) return null

  const commentsEnabled = commentFor !== undefined && onCommentChange !== undefined

  const renderLine = (
    diff: DiffHunk,
    hunk: UnifiedHunk,
    hunkIndex: number,
    line: UnifiedLine,
    key: string,
  ) => {
    const sign = line.kind === 'del' ? '-' : line.kind === 'add' ? '+' : ' '
    const anchor = anchorFor(diff, hunk, hunkIndex, line)
    const anchorKey = `${hunkIndex}:${line.rowIndex}`
    const comment = commentFor?.(anchor)
    const isEditing = editing === anchorKey
    const displayLine = lineNumber(line) ?? 0
    const commit = (): void => {
      const body = commentDraft.trim()
      if (body === '') return
      onCommentChange?.(anchor, body)
      setEditing(null)
      setCommentDraft('')
    }
    const cancel = (): void => {
      setEditing(null)
      setCommentDraft('')
    }
    return (
      <Fragment key={key}>
        <div
          className={`${css.unifiedLine} ${css[`unified_${line.kind}`] ?? ''}`}
          data-line-kind={line.kind}
          data-old-line={line.oldNumber ?? undefined}
          data-new-line={line.newNumber ?? undefined}
        >
          <span className={css.unifiedLineNumber}>
            {commentsEnabled && (
              <button
                type="button"
                className={css.commentTrigger}
                aria-label={(comment === undefined ? labels.addComment : labels.editComment)?.(displayLine)
                  ?? `${comment === undefined ? 'Add' : 'Edit'} comment on line ${displayLine}`}
                onClick={() => {
                  setEditing(anchorKey)
                  setCommentDraft(comment ?? '')
                }}
              >+</button>
            )}
            <span>{lineNumber(line)}</span>
          </span>
          <span className={css.unifiedSign}>{sign}</span>
          <span className={css.unifiedText}>{line.text}</span>
        </div>
        {(comment !== undefined || isEditing) && (
          <div className={css.commentRow} data-review-comment={anchorKey}>
            {isEditing
              ? (
                <>
                  <CommentEditor
                    ariaLabel={(labels.editComment?.(displayLine)) ?? `Edit comment on line ${displayLine}`}
                    placeholder={labels.commentPlaceholder}
                    value={commentDraft}
                    onChange={setCommentDraft}
                    onCommit={commit}
                    onCancel={cancel}
                  />
                  <div className={css.commentActions}>
                    <span className={css.commentHint}>
                      {labels.commentNewlineHint ?? 'Shift+Enter for a new line'}
                    </span>
                    <button type="button" className={css.commentCancel} onClick={cancel}>
                      {labels.cancelComment ?? 'Cancel'}
                    </button>
                    <button
                      type="button"
                      className={css.commentSave}
                      disabled={commentDraft.trim() === ''}
                      onClick={commit}
                    >
                      {labels.saveComment ?? 'Save'}
                    </button>
                  </div>
                </>
              )
              : (
                <>
                  <button
                    type="button"
                    className={css.commentBody}
                    onClick={() => {
                      setEditing(anchorKey)
                      setCommentDraft(comment ?? '')
                    }}
                  >{comment}</button>
                  <div className={css.commentActions}>
                    <button
                      type="button"
                      className={css.commentDelete}
                      onClick={() => {
                        onCommentDelete?.(anchor)
                        setEditing(null)
                        setCommentDraft('')
                      }}
                    >{labels.deleteComment ?? 'Delete'}</button>
                  </div>
                </>
              )}
          </div>
        )}
      </Fragment>
    )
  }

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
    <div
      className={`${css.unifiedBlock} ${showFileHeaders ? '' : css.unifiedEmbedded} ${className ?? ''}`}
      data-diff=""
      data-diff-layout="unified"
    >
      {showCopyButton && (
        <button type="button" className={css.unifiedCopyButton} onClick={onCopy}>
          {copied ? labels.copied : labels.copy}
        </button>
      )}
      {diffs.map((diff, hunkIndex) => {
        const firstForPath = diff.path !== previousPath
        previousPath = diff.path
        const total = totals.get(diff.path) ?? { added: 0, removed: 0 }
        const hunk = hunks[hunkIndex]
        return (
          <section key={`${diff.path}:${hunkIndex}`} className={css.unifiedFile}>
            {showFileHeaders && firstForPath
              ? (
                <header className={css.unifiedHeader}>
                  <span className={css.unifiedStatus}>M</span>
                  <span className={css.unifiedPath}>{diff.path}</span>
                  <span className={css.unifiedAdded}>+{total.added}</span>
                  <span className={css.unifiedRemoved}>-{total.removed}</span>
                </header>
              )
              : !firstForPath && (hunk?.unchangedBefore ?? 0) === 0
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
                  return hunk === undefined ? [] : [renderLine(
                    diff, hunk, hunkIndex, row,
                    `${row.kind}:${row.oldNumber ?? ''}:${row.newNumber ?? ''}:${row.rowIndex}`,
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
                    ...(hunk === undefined ? [] : row.lines.map(line => renderLine(
                      diff, hunk, hunkIndex, line, `${row.id}:${lineNumbers(line)}:${line.rowIndex}`,
                    ))),
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
