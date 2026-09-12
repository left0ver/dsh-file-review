/** Native review-tab contents: files, diffs and line comments. */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_DIFF_LAYOUT, type Config, type DiffLayout } from '../settings-contract.ts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
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

export interface ReviewContentProps extends PropsLocale<typeof NS> {
  readonly reviews: readonly ProducedFileReview[]
  readonly projectRoot?: string | undefined
  readonly sessionId?: string | undefined
  readonly turn: number
  readonly closingSeq: number
  readonly openFile: (path: string) => void
  readonly syncComments?: (() => void) | undefined
  readonly wordWrap?: ObservableSnapshot<boolean> | undefined
  readonly settings?: SettingsScope<Config> | undefined
  readonly visible?: boolean | undefined
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
  settings,
  visible = true,
  t,
}: ReviewContentProps) {
  const [commentVersion, setCommentVersion] = useState(0)
  const [copied, setCopied] = useState(false)
  const copyResetRef = useRef<number | null>(null)
  const [savingLayout, setSavingLayout] = useState(false)
  const [layoutError, setLayoutError] = useState(false)
  const [commentPath, setCommentPath] = useState<string | null>(null)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set())
  const collapsed = reviews.length > 0 && reviews.every((review) => collapsedPaths.has(review.path))
  const subscribeSettings = useCallback(
    (listener: () => void) => (visible ? (settings?.subscribe(listener) ?? (() => {})) : () => {}),
    [settings, visible],
  )
  const getSettings = useCallback(() => settings?.getSnapshot(), [settings])
  const snapshot = useSyncExternalStore(subscribeSettings, getSettings, getSettings)
  const layout = snapshot?.value?.diffLayout ?? DEFAULT_DIFF_LAYOUT
  const changeLayout = async (value: DiffLayout): Promise<void> => {
    if (settings === undefined) return
    setSavingLayout(true)
    setLayoutError(false)
    try {
      await settings.set('diffLayout', value)
    } catch {
      setLayoutError(true)
    } finally {
      setSavingLayout(false)
    }
  }

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
      <header className={css.reviewHeader}>
        <div className={css.reviewHeading}>
          <span className={css.reviewTitle}>{t('review.title')}</span>
          <span className={css.reviewSubtitle}>
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
          <select
            className={css.toolbarButton}
            aria-label={t('review.layout')}
            aria-busy={savingLayout}
            value={layout}
            disabled={!snapshot?.writable || snapshot.status !== 'ready' || savingLayout}
            onChange={(event) => {
              void changeLayout(event.target.value === 'unified' ? 'unified' : 'split')
            }}
          >
            <option value="split">{t('review.layoutSplit')}</option>
            <option value="unified">{t('review.layoutUnified')}</option>
          </select>
          <button
            type="button"
            className={css.toolbarButton}
            aria-label={t(collapsed ? 'review.expandAll' : 'review.collapseAll')}
            title={t(collapsed ? 'review.expandAll' : 'review.collapseAll')}
            aria-expanded={!collapsed}
            disabled={reviews.length === 0}
            onClick={() =>
              setCollapsedPaths(new Set(collapsed ? [] : reviews.map((review) => review.path)))
            }
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
              <path d={collapsed ? 'M5 7l5-4 5 4M5 13l5 4 5-4' : 'M5 3l5 4 5-4M5 17l5-4 5 4'} />
              <path d="M4 10h12" />
            </svg>
            {t(collapsed ? 'review.expandAll' : 'review.collapseAll')}
          </button>
          <button
            type="button"
            className={css.toolbarButton}
            disabled={diffs.length === 0}
            onClick={copyDiff}
          >
            <CopyIcon />
            {copied ? t('review.copied') : t('review.copy')}
          </button>
        </div>
      </header>
      {layoutError && <p role="alert">{t('settings.saveError')}</p>}
      <div className={css.reviewBody}>
        {reviews.map((review) => {
          const fileStats = summarizeDiffs(review.diffs)
          const relativePath = displayProjectPath(review.path, projectRoot)
          const fileCollapsed = collapsedPaths.has(review.path)
          return (
            <section key={review.path} className={css.reviewFile}>
              <header className={css.reviewFileHeader}>
                <span className={css.reviewStatus}>M</span>
                <button
                  type="button"
                  className={css.reviewPath}
                  title={relativePath}
                  aria-label={t(fileCollapsed ? 'review.expandFile' : 'review.collapseFile', {
                    name: relativePath,
                  })}
                  aria-expanded={!fileCollapsed}
                  onClick={() =>
                    setCollapsedPaths((paths) => {
                      const next = new Set(paths)
                      if (next.has(review.path)) next.delete(review.path)
                      else next.add(review.path)
                      return next
                    })
                  }
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
                    <path d={fileCollapsed ? 'M7 5l5 5-5 5' : 'M5 7l5 5 5-5'} />
                  </svg>
                  <span className={css.reviewPathText}>{relativePath}</span>
                </button>
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
              {fileCollapsed ? null : review.diffs.length === 0 ? (
                <p className={css.reviewUnavailable}>{t('review.unavailable')}</p>
              ) : (
                <UnifiedDiff
                  layout={layout}
                  commentsActive={commentPath === review.path}
                  onCommentStart={() => setCommentPath(review.path)}
                  diffs={review.diffs}
                  contextLines={3}
                  showCopyButton={false}
                  showFileHeaders={false}
                  wordWrap={wordWrap}
                  labels={{
                    before: t('review.before'),
                    after: t('review.after'),
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
