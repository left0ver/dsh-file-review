/** Container-neutral review presentation shared by the standalone drawer and sidebar tab. */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Ref } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FileReviewRequest, FileReviewResult } from '../change-types.ts'
import { displayProjectPath } from './project-path.ts'
import {
  deleteReviewComment,
  reviewCommentKey,
  reviewCommentsForTurn,
  setReviewComment,
  subscribeReviewComments,
} from './review-comments.ts'
import type { NS } from './locales.ts'
import {
  summarizeDiffs,
  UnifiedDiff,
  unifiedDiffText,
  type DiffLineAnchor,
  type UnifiedDiffStats,
} from './UnifiedDiff.tsx'
import type { ProducedFileReview } from './turn-deliverables.ts'
import css from './ProducedFiles.module.css'

export const DEFAULT_WORD_WRAP_SOURCE: ObservableSnapshot<boolean> = {
  getSnapshot: () => false,
  subscribe: () => () => {},
}

function addStats(left: UnifiedDiffStats, right: UnifiedDiffStats): UnifiedDiffStats {
  return { added: left.added + right.added, removed: left.removed + right.removed }
}

export function ReviewStats({
  stats,
  label,
}: {
  readonly stats: UnifiedDiffStats
  readonly label: string
}) {
  return (
    <span className={css.stats} aria-label={label}>
      <span className={css.added}>+{stats.added}</span>
      <span className={css.removed}>-{stats.removed}</span>
    </span>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
      <path d="M13.5 6.5v-2a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.closeIcon}>
      <path d="m5.5 5.5 9 9m0-9-9 9" />
    </svg>
  )
}

export interface ReviewContentProps extends PropsLocale<typeof NS> {
  readonly reviews: readonly ProducedFileReview[]
  readonly projectRoot?: string | undefined
  readonly sessionId?: string | undefined
  readonly turn: number
  readonly closingSeq: number
  readonly openFile: (path: string) => void
  readonly inspectChanges: (request: FileReviewRequest) => Promise<FileReviewResult>
  readonly applyChanges: (request: FileReviewRequest) => Promise<FileReviewResult>
  readonly syncComments?: (() => void) | undefined
  readonly wordWrap?: ObservableSnapshot<boolean> | undefined
  readonly visible?: boolean | undefined
  readonly titleId?: string | undefined
  readonly onClose?: (() => void) | undefined
  readonly closeButtonRef?: Ref<HTMLButtonElement> | undefined
}

/** Render review header, actions, files, diffs and line comments without owning a shell. */
export function ReviewContent({
  reviews,
  projectRoot,
  sessionId,
  turn,
  closingSeq,
  openFile,
  syncComments,
  wordWrap: wordWrapSource = DEFAULT_WORD_WRAP_SOURCE,
  visible = true,
  titleId,
  onClose,
  closeButtonRef,
  t,
}: ReviewContentProps) {
  const [commentVersion, setCommentVersion] = useState(0)
  const [copied, setCopied] = useState(false)
  const copyResetRef = useRef<number | null>(null)

  const subscribeWordWrap = useCallback(
    (listener: () => void) => (visible ? wordWrapSource.subscribe(listener) : () => {}),
    [visible, wordWrapSource],
  )
  const wordWrap = useSyncExternalStore(
    subscribeWordWrap,
    wordWrapSource.getSnapshot,
    wordWrapSource.getSnapshot,
  )

  useEffect(() => {
    if (!visible || sessionId === undefined) return undefined
    setCommentVersion((version) => version + 1)
    return subscribeReviewComments(sessionId, () => {
      setCommentVersion((version) => version + 1)
    })
  }, [sessionId, visible])

  useEffect(() => {
    if (visible) syncComments?.()
  }, [syncComments, visible])

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    },
    [],
  )

  const comments = useMemo(
    () =>
      sessionId === undefined
        ? new Map<string, never>()
        : reviewCommentsForTurn(sessionId, turn, closingSeq),
    [closingSeq, commentVersion, sessionId, turn, visible],
  )

  const commentFor = useCallback(
    (anchor: DiffLineAnchor): string | undefined =>
      comments.get(reviewCommentKey(turn, closingSeq, anchor))?.body,
    [closingSeq, comments, turn],
  )
  const onCommentChange = useCallback(
    (anchor: DiffLineAnchor, body: string) => {
      if (sessionId === undefined) return
      setReviewComment({ sessionId, turn, closingSeq, anchor, body })
      syncComments?.()
    },
    [closingSeq, sessionId, syncComments, turn],
  )
  const onCommentDelete = useCallback(
    (anchor: DiffLineAnchor) => {
      if (sessionId === undefined) return
      deleteReviewComment(sessionId, turn, closingSeq, anchor)
      syncComments?.()
    },
    [closingSeq, sessionId, syncComments, turn],
  )

  const diffs = useMemo(() => reviews.flatMap((review) => review.diffs), [reviews])
  const stats = useMemo(
    () =>
      reviews.reduce<UnifiedDiffStats>(
        (total, review) => addStats(total, summarizeDiffs(review.diffs)),
        { added: 0, removed: 0 },
      ),
    [reviews],
  )
  const copyDiff = useCallback(() => {
    if (diffs.length === 0 || copied) return
    const pending = navigator.clipboard?.writeText(unifiedDiffText(diffs))
    if (pending === undefined) return
    setCopied(true)
    void pending
      .then(() => {
        if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
        copyResetRef.current = window.setTimeout(() => {
          setCopied(false)
          copyResetRef.current = null
        }, 1000)
      })
      .catch(() => {
        setCopied(false)
      })
  }, [copied, diffs])

  return (
    <div className={css.reviewContent} data-review-content="">
      <header className={css.drawerHeader}>
        <div className={css.drawerHeading}>
          <span id={titleId} className={css.drawerTitle}>
            {t('review.title')}
          </span>
          <span className={css.drawerSubtitle}>
            {reviews.length === 1
              ? t('review.fileOne')
              : t('review.files', { count: String(reviews.length) })}
          </span>
        </div>
        <ReviewStats
          stats={stats}
          label={t('review.stats', {
            added: String(stats.added),
            removed: String(stats.removed),
          })}
        />
        <div className={css.reviewToolbar}>
          <button
            type="button"
            className={css.toolbarButton}
            disabled={diffs.length === 0}
            onClick={copyDiff}
          >
            <CopyIcon />
            {copied ? t('review.copied') : t('review.copy')}
          </button>
          {onClose !== undefined && (
            <button
              ref={closeButtonRef}
              type="button"
              className={css.closeButton}
              aria-label={t('review.close')}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </header>
      <div className={css.drawerBody}>
        {reviews.map((review) => {
          const fileStats = summarizeDiffs(review.diffs)
          const relativePath = displayProjectPath(review.path, projectRoot)
          return (
            <section key={review.path} className={css.reviewFile}>
              <header className={css.reviewFileHeader}>
                <span className={css.reviewStatus}>M</span>
                <span className={css.reviewPath} title={relativePath}>
                  {relativePath}
                </span>
                <ReviewStats
                  stats={fileStats}
                  label={t('review.stats', {
                    added: String(fileStats.added),
                    removed: String(fileStats.removed),
                  })}
                />
                <button
                  type="button"
                  className={css.openButton}
                  onClick={() => {
                    openFile(review.path)
                  }}
                >
                  {t('review.openInEditor')}
                </button>
              </header>
              {review.diffs.length === 0 ? (
                <p className={css.reviewUnavailable}>{t('review.unavailable')}</p>
              ) : (
                <UnifiedDiff
                  diffs={review.diffs}
                  contextLines={3}
                  showCopyButton={false}
                  showFileHeaders={false}
                  wordWrap={wordWrap}
                  labels={{
                    copy: t('review.copy'),
                    copied: t('review.copied'),
                    showUnchanged: (count) => t('review.showUnchanged', { count: String(count) }),
                    hideUnchanged: (count) => t('review.hideUnchanged', { count: String(count) }),
                    addComment: (line) => t('review.commentAdd', { line: String(line) }),
                    editComment: (line) => t('review.commentEdit', { line: String(line) }),
                    commentPlaceholder: t('review.commentPlaceholder'),
                    commentNewlineHint: t('review.commentNewlineHint'),
                    cancelComment: t('review.commentCancel'),
                    saveComment: t('review.commentSave'),
                    deleteComment: t('review.commentDelete'),
                  }}
                  commentFor={sessionId === undefined ? undefined : commentFor}
                  onCommentChange={sessionId === undefined ? undefined : onCommentChange}
                  onCommentDelete={sessionId === undefined ? undefined : onCommentDelete}
                  className={css.reviewDiff}
                />
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
