// ProducedFiles: the review card a finished turn ends with. Paths and hunks
// come from mutation-tool results, never from the closing prose.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent,
} from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { basename, type ProducedFileReview } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import {
  summarizeDiffs, UnifiedDiff, unifiedDiffText, type UnifiedDiffStats,
} from './UnifiedDiff.tsx'
import css from './ProducedFiles.module.css'

/** Keep the turn-tail card compact; the drawer always contains every file. */
const SHOWN_LIMIT = 6
const DRAWER_RATIO_KEY = 'dsh-file-review:drawer-ratio'
const DRAWER_DEFAULT_RATIO = 0.36
const DRAWER_MIN_RATIO = 0.24
const DRAWER_MAX_RATIO = 0.75
const DRAWER_KEYBOARD_STEP = 0.02
const MOBILE_BREAKPOINT = 760
const HOST_DRAWER_TRACK_PROPERTY = '--dsh-file-review-drawer-width'

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
} & PropsLocale<typeof NS>

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

function addStats(left: UnifiedDiffStats, right: UnifiedDiffStats): UnifiedDiffStats {
  return { added: left.added + right.added, removed: left.removed + right.removed }
}

function Stats({ stats }: { readonly stats: UnifiedDiffStats }) {
  return (
    <span className={css.stats} aria-label={`${stats.added} added, ${stats.removed} removed`}>
      <span className={css.added}>+{stats.added}</span>
      <span className={css.removed}>-{stats.removed}</span>
    </span>
  )
}

/** Render one turn's produced files as a summary card and review drawer. */
export function ProducedFiles({ matched: reviews, openFile, t }: ProducedFilesProps) {
  const drawerTitleId = useId()
  const [reviewScope, setReviewScope] = useState<ReviewScope | null>(null)
  const [copied, setCopied] = useState(false)
  const [drawerRatio, setDrawerRatio] = useState<number | null>(storedDrawerRatio)
  const [currentViewportWidth, setCurrentViewportWidth] = useState(viewportWidth)
  const [isResizing, setIsResizing] = useState(false)
  const [isHostSplit, setIsHostSplit] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const hostSplitRef = useRef<ActiveHostSplit | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const copyResetRef = useRef<number | null>(null)
  const resizeDragRef = useRef<ResizeDrag | null>(null)

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
  const shown = reviewsWithStats.slice(0, SHOWN_LIMIT)
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

  const openReview = useCallback((scope: ReviewScope, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger
    setCopied(false)
    setReviewScope(scope)
  }, [])
  const closeReview = useCallback(() => { setReviewScope(null) }, [])

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
            <Stats stats={totalStats} />
          </div>
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
              <Stats stats={stats} />
            </button>
          ))}
          {hidden > 0 && (
            <div className={css.moreFiles}>
              {hidden === 1
                ? t('produced.moreOne')
                : t('produced.more', { count: String(hidden) })}
            </div>
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
            <Stats stats={visibleStats} />
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
              return (
                <section key={review.path} className={css.reviewFile}>
                  <header className={css.reviewFileHeader}>
                    <span className={css.reviewStatus}>M</span>
                    <span className={css.reviewPath} title={review.path}>{review.path}</span>
                    <Stats stats={stats} />
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
                        labels={{
                          copy: t('review.copy'),
                          copied: t('review.copied'),
                          showUnchanged: count => t('review.showUnchanged', { count: String(count) }),
                          hideUnchanged: count => t('review.hideUnchanged', { count: String(count) }),
                        }}
                        className={css.reviewDiff}
                      />
                    )}
                </section>
              )
            })}
          </div>
        </aside>
      )}
    </>
  )
}
