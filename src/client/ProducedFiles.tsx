// ProducedFiles: the review card a finished turn ends with. Paths and hunks
// come from mutation-tool results, never from the closing prose.

import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore,
} from 'react'
import type {
  CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent,
} from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  FileReviewAction, FileReviewRequest, FileReviewResult,
} from '../change-types.ts'
import { isReversibleChange } from '../file-review-change.ts'
import { basename, type ProducedFileReview } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import {
  summarizeDiffs, UnifiedDiff, unifiedDiffText, type UnifiedDiffStats,
} from './UnifiedDiff.tsx'
import type { DiffLineAnchor } from './UnifiedDiff.tsx'
import {
  deleteReviewComment, reviewCommentKey, reviewCommentsForTurn, setReviewComment,
  subscribeReviewComments,
} from './review-comments.ts'
import css from './ProducedFiles.module.css'
import { displayProjectPath } from './project-path.ts'

/** Keep the turn-tail card compact; the drawer always contains every file. */
const SHOWN_LIMIT = 6
const DRAWER_RATIO_KEY = 'dsh-file-review:drawer-ratio'
const DRAWER_DEFAULT_RATIO = 0.36
const DRAWER_MIN_RATIO = 0.24
const DRAWER_MAX_RATIO = 0.75
const DRAWER_KEYBOARD_STEP = 0.02
const MOBILE_BREAKPOINT = 760
const HOST_DRAWER_TRACK_PROPERTY = '--dsh-file-review-drawer-width'
const SUCCESS_NOTICE_DURATION = 2000
const ERROR_NOTICE_DURATION = 5000

const DEFAULT_WORD_WRAP_SOURCE: ObservableSnapshot<boolean> = {
  getSnapshot: () => false,
  subscribe: () => () => {},
}

/** Review drawers share the host's single details column, so only one may own it at a time. */
let activeReviewOwner: symbol | null = null

function claimReviewDrawer(owner: symbol): boolean {
  if (activeReviewOwner !== null) return activeReviewOwner === owner
  activeReviewOwner = owner
  return true
}

function releaseReviewDrawer(owner: symbol): void {
  if (activeReviewOwner === owner) activeReviewOwner = null
}

type ReviewScope = { readonly kind: 'all' } | { readonly kind: 'file'; readonly path: string }

interface ResizeDrag {
  readonly pointerId: number
  readonly startX: number
  readonly startWidth: number
  currentRatio: number
}

interface HostSplitLayout {
  readonly frame: HTMLElement
  readonly sidebar: HTMLElement
  readonly center: HTMLElement
  readonly details: HTMLElement
}

interface ActiveHostSplit {
  readonly layout: HostSplitLayout
  readonly splitColumns: string
  readonly previousGridTemplateColumns: string
  readonly previousDrawerTrack: string
}

interface NoticeFile {
  readonly path: string
}

interface ToggleNotice {
  readonly seq: number
  readonly tone: 'success' | 'error'
  readonly title: string
  readonly description?: string | undefined
  readonly files: readonly NoticeFile[]
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1280 : window.innerWidth
}

function clampDrawerRatio(ratio: number): number {
  const clamped = Math.min(DRAWER_MAX_RATIO, Math.max(DRAWER_MIN_RATIO, ratio))
  return Math.round(clamped * 10_000) / 10_000
}

function storedDrawerRatio(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = Number.parseFloat(window.localStorage.getItem(DRAWER_RATIO_KEY) ?? '')
    return Number.isFinite(stored) ? clampDrawerRatio(stored) : null
  } catch {
    return null
  }
}

function persistDrawerRatio(ratio: number | null): void {
  try {
    if (ratio === null) window.localStorage.removeItem(DRAWER_RATIO_KEY)
    else window.localStorage.setItem(DRAWER_RATIO_KEY, String(ratio))
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

/** Locate the host's sidebar / conversation / details grid without relying on hashed classes. */
function findHostSplitLayout(anchor: HTMLElement): HostSplitLayout | null {
  let directChild: HTMLElement = anchor
  for (let candidate = anchor.parentElement; candidate !== null; candidate = candidate.parentElement) {
    if (getComputedStyle(candidate).display === 'grid') {
      const children = Array.from(candidate.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      )
      const centerIndex = children.indexOf(directChild)
      if (centerIndex > 0 && centerIndex + 1 < children.length) {
        const sidebar = children[centerIndex - 1]
        const details = children[centerIndex + 1]
        if (sidebar !== undefined && details !== undefined
          && details.getBoundingClientRect().width <= 1) {
          return { frame: candidate, sidebar, center: directChild, details }
        }
      }
    }
    directChild = candidate
  }
  return null
}

function sidebarTrackWidth(layout: HostSplitLayout): number {
  const rectWidth = layout.sidebar.getBoundingClientRect().width
  if (rectWidth > 0) return rectWidth
  const styleWidth = Number.parseFloat(getComputedStyle(layout.sidebar).width)
  return Number.isFinite(styleWidth) ? styleWidth : 0
}

function drawerTrackForRatio(ratio: number): string {
  return `${Number((ratio * 100).toFixed(2))}vw`
}

/** Matched file reviews plus the opener and locale supplied by the turn-tail slot. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly ProducedFileReview[]
  /** Session workspace root, used only to shorten paths shown in the review UI. */
  projectRoot?: string | undefined
  inspectChanges?: (request: FileReviewRequest) => Promise<FileReviewResult>
  applyChanges?: (request: FileReviewRequest) => Promise<FileReviewResult>
  /** Runtime-injected session identity; absent only in isolated render tests. */
  sessionId?: string | undefined
  /** Turn-tail identity used to keep repeated file/line coordinates distinct. */
  turn?: TurnTailOwnerProps['turn'] | undefined
  seq?: number | undefined
  /** Reconcile the aggregate review-comment reference in the session composer. */
  syncComments?: (() => void) | undefined
  /** Live display-only preference for visually wrapping logical diff lines. */
  wordWrap?: ObservableSnapshot<boolean> | undefined
} & PropsLocale<typeof NS>

const unavailableChanges = async (request: FileReviewRequest): Promise<FileReviewResult> => ({
  files: request.files.map(file => ({
    path: file.path,
    state: 'unsupported',
    changed: false,
    reason: 'Host file toggle is unavailable',
  })),
})

function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.icon}>
      <path d="M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" />
      <path d="M11.25 2.75v3.5h3.5M7 10h5M7 13h5" />
    </svg>
  )
}

function ReviewIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <path d="M4.5 3.5h8a1 1 0 0 1 1 1v3M6.5 6.5h4M6.5 9.5h2.25" />
      <path d="m10.5 13 1.5 1.5 3.5-4" />
    </svg>
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

function ResultToast({
  notice, closeLabel, dismissLabel, fileListLabel, fileOpenLabel, openFile, onDone,
}: {
  readonly notice: ToggleNotice
  readonly closeLabel: string
  readonly dismissLabel: string
  readonly fileListLabel: string
  readonly fileOpenLabel: (path: string) => string
  readonly openFile: (path: string) => void
  readonly onDone: () => void
}) {
  useEffect(() => {
    const duration = notice.tone === 'success'
      ? SUCCESS_NOTICE_DURATION
      : ERROR_NOTICE_DURATION
    const timer = window.setTimeout(onDone, duration)
    return () => { window.clearTimeout(timer) }
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
          aria-label={closeLabel}
          onClick={onDone}
        >
          <CloseIcon />
        </button>
      </div>
      {notice.files.length > 0 && (
        <div className={css.noticeFiles}>
          <span className={css.noticeFileListLabel}>{fileListLabel}</span>
          <ul className={css.noticeFileList}>
            {notice.files.map(file => (
              <li key={file.path}>
                <button
                  type="button"
                  className={css.noticeFileButton}
                  aria-label={fileOpenLabel(file.path)}
                  onClick={() => { openFile(file.path) }}
                >
                  <span className={css.noticeFilePath}>{basename(file.path)}</span>
                  <span className={css.noticeFileArrow} aria-hidden="true">↗</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {notice.tone === 'error' && (
        <button type="button" className={css.noticeDismissButton} onClick={onDone}>
          {dismissLabel}
        </button>
      )}
    </div>
  )
}

function addStats(left: UnifiedDiffStats, right: UnifiedDiffStats): UnifiedDiffStats {
  return { added: left.added + right.added, removed: left.removed + right.removed }
}

function Stats({ stats, label }: { readonly stats: UnifiedDiffStats; readonly label: string }) {
  return (
    <span className={css.stats} aria-label={label}>
      <span className={css.added}>+{stats.added}</span>
      <span className={css.removed}>-{stats.removed}</span>
    </span>
  )
}

/** Render one turn's produced files as a summary card and review drawer. */
export function ProducedFiles({
  matched: reviews, openFile, projectRoot,
  inspectChanges = unavailableChanges, applyChanges = unavailableChanges,
  sessionId, turn, seq = 0, syncComments, wordWrap: wordWrapSource = DEFAULT_WORD_WRAP_SOURCE, t,
}: ProducedFilesProps) {
  const wordWrap = useSyncExternalStore(
    wordWrapSource.subscribe,
    wordWrapSource.getSnapshot,
    wordWrapSource.getSnapshot,
  )
  const drawerTitleId = useId()
  const [reviewScope, setReviewScope] = useState<ReviewScope | null>(null)
  const [copied, setCopied] = useState(false)
  const [drawerRatio, setDrawerRatio] = useState<number | null>(storedDrawerRatio)
  const [currentViewportWidth, setCurrentViewportWidth] = useState(viewportWidth)
  const [isResizing, setIsResizing] = useState(false)
  const [isHostSplit, setIsHostSplit] = useState(false)
  const [toggleAction, setToggleAction] = useState<FileReviewAction>('undo')
  const [statusPending, setStatusPending] = useState(true)
  const [togglePending, setTogglePending] = useState(false)
  const [toast, setToast] = useState<ToggleNotice | null>(null)
  const [commentVersion, setCommentVersion] = useState(0)
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false)
  const toastSeqRef = useRef(0)
  const reviewOwnerRef = useRef(Symbol('review-drawer-owner'))
  const cardRef = useRef<HTMLElement>(null)
  const hostSplitRef = useRef<ActiveHostSplit | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const copyResetRef = useRef<number | null>(null)
  const resizeDragRef = useRef<ResizeDrag | null>(null)
  const turnNumber = turn?.turn ?? 0

  useEffect(() => {
    if (sessionId === undefined) return undefined
    const unsubscribe = subscribeReviewComments(sessionId, () => {
      setCommentVersion(version => version + 1)
    })
    return unsubscribe
  }, [sessionId])

  // Locale changes re-render this component; reconcile on every committed render
  // so the cached composer-chip label follows the active language as well.
  useEffect(() => { syncComments?.() })

  const turnComments = useMemo(
    () => sessionId === undefined
      ? new Map<string, never>()
      : reviewCommentsForTurn(sessionId, turnNumber, seq),
    [commentVersion, seq, sessionId, turnNumber],
  )

  const commentFor = useCallback((anchor: DiffLineAnchor): string | undefined =>
    turnComments.get(reviewCommentKey(turnNumber, seq, anchor))?.body,
  [seq, turnComments, turnNumber])

  const onCommentChange = useCallback((anchor: DiffLineAnchor, body: string) => {
    if (sessionId === undefined) return
    setReviewComment({ sessionId, turn: turnNumber, closingSeq: seq, anchor, body })
    syncComments?.()
  }, [seq, sessionId, syncComments, turnNumber])

  const onCommentDelete = useCallback((anchor: DiffLineAnchor) => {
    if (sessionId === undefined) return
    deleteReviewComment(sessionId, turnNumber, seq, anchor)
    syncComments?.()
  }, [seq, sessionId, syncComments, turnNumber])

  const reviewsWithStats = useMemo(() => reviews.map(review => ({
    review,
    stats: summarizeDiffs(review.diffs),
  })), [reviews])
  const totalStats = useMemo(
    () => reviewsWithStats.reduce<UnifiedDiffStats>(
      (total, item) => addStats(total, item.stats),
      { added: 0, removed: 0 },
    ),
    [reviewsWithStats],
  )
  const toggleFiles = useMemo(() => reviews.map(review => ({
    path: review.path,
    diffs: review.diffs,
    ...(review.complete === false ? { complete: false as const } : {}),
  })), [reviews])
  const reversiblePaths = useMemo(() => new Set(
    reviews.filter(review => isReversibleChange(review)).map(review => review.path),
  ), [reviews])
  const hasReversibleFiles = reversiblePaths.size > 0
  const shown = isPreviewExpanded
    ? reviewsWithStats
    : reviewsWithStats.slice(0, SHOWN_LIMIT)
  const hidden = reviewsWithStats.length - shown.length
  const visibleReviews = useMemo(() => reviewScope?.kind === 'file'
    ? reviews.filter(review => review.path === reviewScope.path)
    : reviews, [reviewScope, reviews])
  const visibleDiffs = useMemo(
    () => visibleReviews.flatMap(review => review.diffs),
    [visibleReviews],
  )
  const visibleStats = useMemo(() => visibleReviews.reduce<UnifiedDiffStats>(
    (total, review) => addStats(total, summarizeDiffs(review.diffs)),
    { added: 0, removed: 0 },
  ), [visibleReviews])

  const showToast = useCallback((notice: Omit<ToggleNotice, 'seq'>) => {
    toastSeqRef.current += 1
    setToast({ seq: toastSeqRef.current, ...notice })
  }, [])

  const phaseForResult = useCallback((
    result: FileReviewResult,
    currentAction: FileReviewAction,
  ): FileReviewAction => {
    if (reversiblePaths.size === 0) return 'undo'
    const byPath = new Map(result.files.map(file => [file.path, file]))
    const target = currentAction === 'undo' ? 'undone' : 'applied'
    return [...reversiblePaths].every(path => byPath.get(path)?.state === target)
      ? (currentAction === 'undo' ? 'redo' : 'undo')
      : currentAction
  }, [reversiblePaths])

  useEffect(() => {
    let active = true
    setStatusPending(true)
    void inspectChanges({ action: 'undo', files: toggleFiles }).then((result) => {
      if (!active) return
      const allUndone = reversiblePaths.size > 0
        && [...reversiblePaths].every(path =>
          result.files.find(file => file.path === path)?.state === 'undone')
      setToggleAction(allUndone ? 'redo' : 'undo')
    }).catch(() => {
      // The action remains usable after a transient inspection failure; execution
      // performs the same Host-side checks again.
    }).finally(() => {
      if (active) setStatusPending(false)
    })
    return () => { active = false }
  }, [inspectChanges, reversiblePaths, toggleFiles])

  const runToggle = useCallback(() => {
    if (statusPending || togglePending || !hasReversibleFiles) return
    const action = toggleAction
    setTogglePending(true)
    void applyChanges({ action, files: toggleFiles }).then((result) => {
      setToggleAction(phaseForResult(result, action))
      const targetState = action === 'undo' ? 'undone' : 'applied'
      const byPath = new Map(result.files.map(file => [file.path, file]))
      const failures: NoticeFile[] = toggleFiles.flatMap((file) => {
        const outcome = byPath.get(file.path)
        if (outcome?.state === targetState) return []
        return [{ path: file.path }]
      })
      if (failures.length === 0) {
        showToast({
          tone: 'success',
          title: t(action === 'undo' ? 'produced.undoSuccess' : 'produced.redoSuccess'),
          files: [],
        })
        return
      }
      showToast({
        tone: 'error',
        title: t(action === 'undo' ? 'produced.undoPartial' : 'produced.redoPartial'),
        description: t(action === 'undo'
          ? 'produced.undoPartialDescription'
          : 'produced.redoPartialDescription'),
        files: failures,
      })
    }).catch((error: unknown) => {
      showToast({
        tone: 'error',
        title: t(action === 'undo' ? 'produced.undoError' : 'produced.redoError'),
        description: error instanceof Error ? error.message : String(error),
        files: [],
      })
    }).finally(() => { setTogglePending(false) })
  }, [
    applyChanges, hasReversibleFiles, phaseForResult, showToast, t,
    statusPending, toggleAction, toggleFiles, togglePending,
  ])

  const openReview = useCallback((scope: ReviewScope, trigger: HTMLButtonElement) => {
    if (!claimReviewDrawer(reviewOwnerRef.current)) return
    triggerRef.current = trigger
    setCopied(false)
    setReviewScope(scope)
  }, [])
  const closeReview = useCallback(() => {
    releaseReviewDrawer(reviewOwnerRef.current)
    setReviewScope(null)
  }, [])

  useEffect(() => () => { releaseReviewDrawer(reviewOwnerRef.current) }, [])

  useEffect(() => {
    if (reviewScope === null) return
    closeButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeReview()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      triggerRef.current?.focus()
    }
  }, [closeReview, reviewScope])

  useEffect(() => () => {
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
  }, [])

  const effectiveDrawerRatio = drawerRatio ?? DRAWER_DEFAULT_RATIO
  const drawerWidthViewportPercent = drawerRatio === null
    ? null
    : Number((drawerRatio * 100).toFixed(2))
  const drawerTrack = drawerTrackForRatio(effectiveDrawerRatio)
  const reviewIsOpen = reviewScope !== null

  useLayoutEffect(() => {
    if (!reviewIsOpen || currentViewportWidth <= MOBILE_BREAKPOINT
      || cardRef.current === null) {
      setIsHostSplit(false)
      return
    }
    const layout = findHostSplitLayout(cardRef.current)
    if (layout === null) {
      setIsHostSplit(false)
      return
    }

    const previousGridTemplateColumns = layout.frame.style.gridTemplateColumns
    const previousDrawerTrack = layout.frame.style.getPropertyValue(HOST_DRAWER_TRACK_PROPERTY)
    const previousDetailsVisibility = layout.details.style.visibility
    const previousDetailsPointerEvents = layout.details.style.pointerEvents
    const previousDetailsAriaHidden = layout.details.getAttribute('aria-hidden')
    const sidebarWidth = sidebarTrackWidth(layout)
    const splitColumns = `${sidebarWidth}px minmax(0, 1fr) var(${HOST_DRAWER_TRACK_PROPERTY})`
    layout.frame.style.setProperty(HOST_DRAWER_TRACK_PROPERTY, drawerTrack)
    layout.frame.style.gridTemplateColumns = splitColumns
    layout.details.style.visibility = 'hidden'
    layout.details.style.pointerEvents = 'none'
    layout.details.setAttribute('aria-hidden', 'true')
    hostSplitRef.current = {
      layout, splitColumns, previousGridTemplateColumns, previousDrawerTrack,
    }
    setIsHostSplit(true)

    return () => {
      if (layout.frame.style.gridTemplateColumns === splitColumns) {
        layout.frame.style.gridTemplateColumns = previousGridTemplateColumns
      }
      if (previousDrawerTrack === '') {
        layout.frame.style.removeProperty(HOST_DRAWER_TRACK_PROPERTY)
      } else {
        layout.frame.style.setProperty(HOST_DRAWER_TRACK_PROPERTY, previousDrawerTrack)
      }
      layout.details.style.visibility = previousDetailsVisibility
      layout.details.style.pointerEvents = previousDetailsPointerEvents
      if (previousDetailsAriaHidden === null) {
        layout.details.removeAttribute('aria-hidden')
      } else {
        layout.details.setAttribute('aria-hidden', previousDetailsAriaHidden)
      }
      hostSplitRef.current = null
    }
  }, [currentViewportWidth, reviewIsOpen])

  useLayoutEffect(() => {
    hostSplitRef.current?.layout.frame.style.setProperty(HOST_DRAWER_TRACK_PROPERTY, drawerTrack)
  }, [drawerTrack])

  useEffect(() => {
    const onResize = (): void => { setCurrentViewportWidth(viewportWidth()) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  useEffect(() => {
    if (reviewScope?.kind !== 'file') return
    if (!reviews.some(review => review.path === reviewScope.path)) closeReview()
  }, [closeReview, reviewScope, reviews])

  const copyVisibleDiff = useCallback(() => {
    if (visibleDiffs.length === 0 || copied) return
    const pending = navigator.clipboard?.writeText(unifiedDiffText(visibleDiffs))
    if (pending === undefined) return
    setCopied(true)
    void pending.then(() => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
      copyResetRef.current = window.setTimeout(() => {
        setCopied(false)
        copyResetRef.current = null
      }, 1000)
    }).catch(() => { setCopied(false) })
  }, [copied, visibleDiffs])

  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || window.innerWidth <= MOBILE_BREAKPOINT) return
    const startRatio = drawerRatio ?? DRAWER_DEFAULT_RATIO
    const startWidth = viewportWidth() * startRatio
    resizeDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      currentRatio: startRatio,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setIsResizing(true)
    event.preventDefault()
  }, [drawerRatio])

  const onResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const next = clampDrawerRatio(
      (drag.startWidth + drag.startX - event.clientX) / viewportWidth(),
    )
    drag.currentRatio = next
    hostSplitRef.current?.layout.frame.style.setProperty(
      HOST_DRAWER_TRACK_PROPERTY,
      drawerTrackForRatio(next),
    )
    setDrawerRatio(next)
  }, [])

  const finishResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizeDragRef.current = null
    setIsResizing(false)
    persistDrawerRatio(drag.currentRatio)
  }, [])

  const onResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = drawerRatio ?? DRAWER_DEFAULT_RATIO
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = clampDrawerRatio(current + DRAWER_KEYBOARD_STEP)
    if (event.key === 'ArrowRight') next = clampDrawerRatio(current - DRAWER_KEYBOARD_STEP)
    if (event.key === 'Home') next = DRAWER_MIN_RATIO
    if (event.key === 'End') next = DRAWER_MAX_RATIO
    if (next === null) return
    event.preventDefault()
    hostSplitRef.current?.layout.frame.style.setProperty(
      HOST_DRAWER_TRACK_PROPERTY,
      drawerTrackForRatio(next),
    )
    setDrawerRatio(next)
    persistDrawerRatio(next)
  }, [drawerRatio])

  const resetDrawerWidth = useCallback(() => {
    hostSplitRef.current?.layout.frame.style.setProperty(
      HOST_DRAWER_TRACK_PROPERTY,
      drawerTrackForRatio(DRAWER_DEFAULT_RATIO),
    )
    setDrawerRatio(null)
    persistDrawerRatio(null)
  }, [])

  const effectiveDrawerWidth = Math.round(currentViewportWidth * effectiveDrawerRatio)
  const drawerStyle = drawerRatio === null
    ? undefined
    : { '--review-drawer-width': `${drawerWidthViewportPercent}vw` } as CSSProperties

  return (
    <>
      <section ref={cardRef} className={css.card} aria-label={t('produced.summary')}>
        <header className={css.cardHeader}>
          <span className={css.fileIconWrap}><FileIcon /></span>
          <div className={css.cardTitleBlock}>
            <span className={css.cardTitle}>
              {reviews.length === 1
                ? t('produced.editedOne')
                : t('produced.edited', { count: String(reviews.length) })}
            </span>
            <Stats
              stats={totalStats}
              label={t('review.stats', {
                added: String(totalStats.added), removed: String(totalStats.removed),
              })}
            />
          </div>
          <button
            type="button"
            className={css.toggleButton}
            disabled={statusPending || togglePending || !hasReversibleFiles}
            title={!hasReversibleFiles ? t('produced.toggleUnavailable') : undefined}
            aria-label={toggleAction === 'undo' ? t('produced.undo') : t('produced.redo')}
            onClick={runToggle}
          >
            {togglePending
              ? (toggleAction === 'undo' ? t('produced.undoing') : t('produced.redoing'))
              : (toggleAction === 'undo' ? t('produced.undo') : t('produced.redo'))}
          </button>
          <button
            type="button"
            className={css.reviewButton}
            aria-label={t('produced.reviewAll')}
            onClick={event => { openReview({ kind: 'all' }, event.currentTarget) }}
          >
            <ReviewIcon />
            {t('review.title')}
          </button>
        </header>
        <div className={css.fileList}>
          {shown.map(({ review, stats }) => (
            <button
              key={review.path}
              type="button"
              className={css.fileRow}
              title={review.path}
              aria-label={t('produced.review', { name: review.path })}
              onClick={event => {
                openReview({ kind: 'file', path: review.path }, event.currentTarget)
              }}
            >
              <span className={css.fileName}>{basename(review.path)}</span>
              <Stats
                stats={stats}
                label={t('review.stats', {
                  added: String(stats.added), removed: String(stats.removed),
                })}
              />
            </button>
          ))}
          {hidden > 0 && (
            <button
              type="button"
              className={css.moreFiles}
              aria-expanded="false"
              onClick={() => { setIsPreviewExpanded(true) }}
            >
              {hidden === 1
                ? t('produced.moreOne')
                : t('produced.more', { count: String(hidden) })}
            </button>
          )}
        </div>
      </section>

      {reviewScope !== null && (
        <aside
          className={`${css.drawer} ${isHostSplit ? css.drawerSplit : ''} ${isResizing ? css.drawerResizing : ''}`}
          style={drawerStyle}
          role="dialog"
          aria-modal="false"
          aria-labelledby={drawerTitleId}
          data-review-drawer=""
        >
          <div
            className={css.resizeHandle}
            role="separator"
            aria-label={t('review.resize')}
            aria-orientation="vertical"
            aria-valuemin={Math.round(currentViewportWidth * DRAWER_MIN_RATIO)}
            aria-valuemax={Math.round(currentViewportWidth * DRAWER_MAX_RATIO)}
            aria-valuenow={effectiveDrawerWidth}
            tabIndex={0}
            title={t('review.resizeHint')}
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onKeyDown={onResizeKeyDown}
            onDoubleClick={resetDrawerWidth}
          />
          <header className={css.drawerHeader}>
            <div className={css.drawerHeading}>
              <span id={drawerTitleId} className={css.drawerTitle}>{t('review.title')}</span>
              <span className={css.drawerSubtitle}>
                {visibleReviews.length === 1
                  ? t('review.fileOne')
                  : t('review.files', { count: String(visibleReviews.length) })}
              </span>
            </div>
            <Stats
              stats={visibleStats}
              label={t('review.stats', {
                added: String(visibleStats.added), removed: String(visibleStats.removed),
              })}
            />
            <button
              type="button"
              className={css.toolbarButton}
              disabled={visibleDiffs.length === 0}
              onClick={copyVisibleDiff}
            >
              <CopyIcon />
              {copied ? t('review.copied') : t('review.copy')}
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className={css.closeButton}
              aria-label={t('review.close')}
              onClick={closeReview}
            >
              <CloseIcon />
            </button>
          </header>
          <div className={css.drawerBody}>
            {visibleReviews.map((review) => {
              const stats = summarizeDiffs(review.diffs)
              const relativePath = displayProjectPath(review.path, projectRoot)
              return (
                <section key={review.path} className={css.reviewFile}>
                  <header className={css.reviewFileHeader}>
                    <span className={css.reviewStatus}>M</span>
                    <span className={css.reviewPath} title={relativePath}>{relativePath}</span>
                    <Stats
                      stats={stats}
                      label={t('review.stats', {
                        added: String(stats.added), removed: String(stats.removed),
                      })}
                    />
                    <button
                      type="button"
                      className={css.openButton}
                      onClick={() => { openFile(review.path) }}
                    >
                      {t('review.openInEditor')}
                    </button>
                  </header>
                  {review.diffs.length === 0
                    ? <p className={css.reviewUnavailable}>{t('review.unavailable')}</p>
                    : (
                      <UnifiedDiff
                        diffs={review.diffs}
                        contextLines={3}
                        showCopyButton={false}
                        showFileHeaders={false}
                        wordWrap={wordWrap}
                        labels={{
                          copy: t('review.copy'),
                          copied: t('review.copied'),
                          showUnchanged: count => t('review.showUnchanged', { count: String(count) }),
                          hideUnchanged: count => t('review.hideUnchanged', { count: String(count) }),
                          addComment: line => t('review.commentAdd', { line: String(line) }),
                          editComment: line => t('review.commentEdit', { line: String(line) }),
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
        </aside>
      )}
      {toast !== null && (
        <ResultToast
          key={toast.seq}
          notice={toast}
          closeLabel={t('produced.noticeClose')}
          dismissLabel={t('produced.noticeDismiss')}
          fileListLabel={t('produced.skippedFiles', { count: String(toast.files.length) })}
          fileOpenLabel={path => t('produced.open', { name: basename(path) })}
          openFile={openFile}
          onDone={() => { setToast(current => current?.seq === toast.seq ? null : current) }}
        />
      )}
    </>
  )
}
