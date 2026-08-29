/** Shared status/apply state machine and result presentation for every review container. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FileReviewAction, FileReviewRequest, FileReviewResult } from '../change-types.ts'
import { isReversibleChange } from '../file-review-change.ts'
import { basename, type ProducedFileReview } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

const SUCCESS_NOTICE_DURATION = 2000
const ERROR_NOTICE_DURATION = 5000

interface NoticeFile {
  readonly path: string
}

export interface ToggleNotice {
  readonly seq: number
  readonly tone: 'success' | 'error'
  readonly title: string
  readonly description?: string | undefined
  readonly files: readonly NoticeFile[]
}

export const unavailableChanges = async (
  request: FileReviewRequest,
): Promise<FileReviewResult> => ({
  files: request.files.map((file) => ({
    path: file.path,
    state: 'unsupported',
    changed: false,
    reason: 'Host file toggle is unavailable',
  })),
})

interface ReviewActionsOptions {
  readonly reviews: readonly ProducedFileReview[]
  readonly inspectChanges: (request: FileReviewRequest) => Promise<FileReviewResult>
  readonly applyChanges: (request: FileReviewRequest) => Promise<FileReviewResult>
  readonly enabled?: boolean | undefined
  readonly t: TranslateNS<typeof NS>
}

export interface ReviewActions {
  readonly action: FileReviewAction
  readonly statusPending: boolean
  readonly togglePending: boolean
  readonly hasReversibleFiles: boolean
  readonly notice: ToggleNotice | null
  run(): void
  dismissNotice(): void
}

/** Keep Undo/Reapply phase and async stale-write protection identical in every surface. */
export function useReviewActions({
  reviews,
  inspectChanges,
  applyChanges,
  enabled = true,
  t,
}: ReviewActionsOptions): ReviewActions {
  const [action, setAction] = useState<FileReviewAction>('undo')
  const [statusPending, setStatusPending] = useState(enabled)
  const [togglePending, setTogglePending] = useState(false)
  const [notice, setNotice] = useState<ToggleNotice | null>(null)
  const noticeSeqRef = useRef(0)
  const generationRef = useRef(0)
  const mountedRef = useRef(true)

  const files = useMemo(
    () =>
      reviews.map((review) => ({
        path: review.path,
        diffs: review.diffs,
        ...(review.complete === false ? { complete: false as const } : {}),
      })),
    [reviews],
  )
  const reversiblePaths = useMemo(
    () =>
      new Set(reviews.filter((review) => isReversibleChange(review)).map((review) => review.path)),
    [reviews],
  )
  const hasReversibleFiles = reversiblePaths.size > 0

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
    }
  }, [])

  useEffect(() => {
    generationRef.current += 1
    const generation = generationRef.current
    setTogglePending(false)
    setNotice(null)
    if (!enabled) {
      setStatusPending(false)
      return undefined
    }

    setStatusPending(true)
    void inspectChanges({ action: 'undo', files })
      .then((result) => {
        if (!mountedRef.current || generationRef.current !== generation) return
        const allUndone =
          reversiblePaths.size > 0 &&
          [...reversiblePaths].every(
            (path) => result.files.find((file) => file.path === path)?.state === 'undone',
          )
        setAction(allUndone ? 'redo' : 'undo')
      })
      .catch(() => {
        // Execution repeats the authoritative Host checks, so a transient
        // inspection failure does not permanently disable the action.
      })
      .finally(() => {
        if (mountedRef.current && generationRef.current === generation) setStatusPending(false)
      })
    return () => {
      if (generationRef.current === generation) generationRef.current += 1
    }
  }, [enabled, files, inspectChanges, reversiblePaths])

  const showNotice = useCallback((value: Omit<ToggleNotice, 'seq'>) => {
    noticeSeqRef.current += 1
    setNotice({ seq: noticeSeqRef.current, ...value })
  }, [])

  const run = useCallback(() => {
    if (!enabled || statusPending || togglePending || !hasReversibleFiles) return
    const requestedAction = action
    const generation = generationRef.current
    setTogglePending(true)
    void applyChanges({ action: requestedAction, files })
      .then((result) => {
        if (!mountedRef.current || generationRef.current !== generation) return
        const byPath = new Map(result.files.map((file) => [file.path, file]))
        const targetState = requestedAction === 'undo' ? 'undone' : 'applied'
        const nextAction = [...reversiblePaths].every(
          (path) => byPath.get(path)?.state === targetState,
        )
          ? requestedAction === 'undo'
            ? 'redo'
            : 'undo'
          : requestedAction
        setAction(nextAction)
        const failures: NoticeFile[] = files.flatMap((file) =>
          byPath.get(file.path)?.state === targetState ? [] : [{ path: file.path }],
        )
        if (failures.length === 0) {
          showNotice({
            tone: 'success',
            title: t(requestedAction === 'undo' ? 'produced.undoSuccess' : 'produced.redoSuccess'),
            files: [],
          })
          return
        }
        showNotice({
          tone: 'error',
          title: t(requestedAction === 'undo' ? 'produced.undoPartial' : 'produced.redoPartial'),
          description: t(
            requestedAction === 'undo'
              ? 'produced.undoPartialDescription'
              : 'produced.redoPartialDescription',
          ),
          files: failures,
        })
      })
      .catch((error: unknown) => {
        if (!mountedRef.current || generationRef.current !== generation) return
        showNotice({
          tone: 'error',
          title: t(requestedAction === 'undo' ? 'produced.undoError' : 'produced.redoError'),
          description: error instanceof Error ? error.message : String(error),
          files: [],
        })
      })
      .finally(() => {
        if (mountedRef.current && generationRef.current === generation) setTogglePending(false)
      })
  }, [
    action,
    applyChanges,
    enabled,
    files,
    hasReversibleFiles,
    reversiblePaths,
    showNotice,
    statusPending,
    t,
    togglePending,
  ])

  const dismissNotice = useCallback(() => {
    setNotice(null)
  }, [])

  return {
    action,
    statusPending,
    togglePending,
    hasReversibleFiles,
    notice,
    run,
    dismissNotice,
  }
}

function SuccessIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.noticeIconSvg}>
      <path d="m5 10 3.25 3.25L15 6.5" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.noticeIconSvg}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="m7.5 7.5 5 5m0-5-5 5" />
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

export function ReviewResultToast({
  notice,
  t,
  openFile,
  onDone,
}: {
  readonly notice: ToggleNotice
  readonly t: TranslateNS<typeof NS>
  readonly openFile: (path: string) => void
  readonly onDone: () => void
}) {
  useEffect(() => {
    const duration = notice.tone === 'success' ? SUCCESS_NOTICE_DURATION : ERROR_NOTICE_DURATION
    const timer = window.setTimeout(onDone, duration)
    return () => {
      window.clearTimeout(timer)
    }
  }, [notice.tone, onDone])

  return (
    <div
      className={`${css.toast} ${notice.tone === 'success' ? css.toastSuccess : css.toastError}`}
      role="alert"
    >
      <div className={css.toastHeader}>
        <span className={css.noticeIcon}>
          {notice.tone === 'success' ? <SuccessIcon /> : <ErrorIcon />}
        </span>
        <div className={css.toastCopy}>
          <strong className={css.toastTitle}>{notice.title}</strong>
          {notice.description !== undefined && (
            <span className={css.toastDescription}>{notice.description}</span>
          )}
        </div>
        <button
          type="button"
          className={css.toastCloseButton}
          aria-label={t('produced.noticeClose')}
          onClick={onDone}
        >
          <CloseIcon />
        </button>
      </div>
      {notice.files.length > 0 && (
        <div className={css.noticeFiles}>
          <span className={css.noticeFileListLabel}>
            {t('produced.skippedFiles', { count: String(notice.files.length) })}
          </span>
          <ul className={css.noticeFileList}>
            {notice.files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className={css.noticeFileButton}
                  aria-label={t('produced.open', { name: basename(file.path) })}
                  onClick={() => {
                    openFile(file.path)
                  }}
                >
                  <span className={css.noticeFilePath}>{basename(file.path)}</span>
                  <span className={css.noticeFileArrow} aria-hidden="true">
                    ↗
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {notice.tone === 'error' && (
        <button type="button" className={css.noticeDismissButton} onClick={onDone}>
          {t('produced.noticeDismiss')}
        </button>
      )}
    </div>
  )
}
