/** Standalone review shell: the only module allowed to take over the Host details column. */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import type { ReviewContentProps } from './ReviewContent.tsx'
import { ReviewContent } from './ReviewContent.tsx'
import css from './ProducedFiles.module.css'

const DRAWER_RATIO_KEY = 'dsh-file-review:drawer-ratio'
const DRAWER_DEFAULT_RATIO = 0.36
const DRAWER_MIN_RATIO = 0.24
const DRAWER_MAX_RATIO = 0.75
const DRAWER_KEYBOARD_STEP = 0.02
const MOBILE_BREAKPOINT = 760
const HOST_DRAWER_TRACK_PROPERTY = '--dsh-file-review-drawer-width'

interface ActiveReviewDrawer {
  readonly owner: symbol
  readonly close: () => void
}

let activeReviewDrawer: ActiveReviewDrawer | null = null

function activateReviewDrawer(owner: symbol, close: () => void): boolean {
  if (activeReviewDrawer?.owner === owner) return false
  const previous = activeReviewDrawer
  activeReviewDrawer = { owner, close }
  previous?.close()
  return previous !== null
}

function releaseReviewDrawer(owner: symbol): void {
  if (activeReviewDrawer?.owner === owner) activeReviewDrawer = null
}

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

/** Locate the host's sidebar / conversation / details grid without hashed classes. */
function findHostSplitLayout(
  anchor: HTMLElement,
  allowOccupiedDetails = false,
): HostSplitLayout | null {
  let directChild: HTMLElement = anchor
  for (
    let candidate = anchor.parentElement;
    candidate !== null;
    candidate = candidate.parentElement
  ) {
    if (getComputedStyle(candidate).display === 'grid') {
      const children = Array.from(candidate.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      )
      const centerIndex = children.indexOf(directChild)
      if (centerIndex > 0 && centerIndex + 1 < children.length) {
        const sidebar = children[centerIndex - 1]
        const details = children[centerIndex + 1]
        if (
          sidebar !== undefined &&
          details !== undefined &&
          (allowOccupiedDetails || details.getBoundingClientRect().width <= 1)
        ) {
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

export interface StandaloneReviewDrawerProps extends ReviewContentProps {
  readonly anchorRef: RefObject<HTMLElement>
  readonly trigger: HTMLButtonElement | null
  readonly onClose: () => void
}

/** Fixed/mobile Drawer plus desktop details-column ownership and resize behavior. */
export function StandaloneReviewDrawer({
  anchorRef,
  trigger,
  onClose,
  ...contentProps
}: StandaloneReviewDrawerProps) {
  const titleId = useId()
  const ownerRef = useRef(Symbol('review-drawer-owner'))
  const takeoverRef = useRef(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const hostSplitRef = useRef<ActiveHostSplit | null>(null)
  const hostSplitCleanupRef = useRef<(() => void) | null>(null)
  const resizeDragRef = useRef<ResizeDrag | null>(null)
  const [drawerRatio, setDrawerRatio] = useState<number | null>(storedDrawerRatio)
  const [currentViewportWidth, setCurrentViewportWidth] = useState(viewportWidth)
  const [isResizing, setIsResizing] = useState(false)
  const [isHostSplit, setIsHostSplit] = useState(false)

  const closeReview = useCallback(() => {
    hostSplitCleanupRef.current?.()
    onClose()
  }, [onClose])

  useLayoutEffect(() => {
    takeoverRef.current = activateReviewDrawer(ownerRef.current, closeReview)
    return () => {
      releaseReviewDrawer(ownerRef.current)
    }
  }, [closeReview])

  useEffect(() => {
    closeButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeReview()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      trigger?.focus({ preventScroll: true })
    }
  }, [closeReview, trigger])

  const effectiveDrawerRatio = drawerRatio ?? DRAWER_DEFAULT_RATIO
  const drawerTrack = drawerTrackForRatio(effectiveDrawerRatio)

  useLayoutEffect(() => {
    const allowOccupiedDetails = takeoverRef.current
    takeoverRef.current = false
    if (currentViewportWidth <= MOBILE_BREAKPOINT || anchorRef.current === null) {
      setIsHostSplit(false)
      return undefined
    }
    const layout = findHostSplitLayout(anchorRef.current, allowOccupiedDetails)
    if (layout === null) {
      setIsHostSplit(false)
      return undefined
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
      layout,
      splitColumns,
      previousGridTemplateColumns,
      previousDrawerTrack,
    }
    setIsHostSplit(true)

    let cleaned = false
    const cleanup = (): void => {
      if (cleaned) return
      cleaned = true
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
      if (previousDetailsAriaHidden === null) layout.details.removeAttribute('aria-hidden')
      else layout.details.setAttribute('aria-hidden', previousDetailsAriaHidden)
      hostSplitRef.current = null
      if (hostSplitCleanupRef.current === cleanup) hostSplitCleanupRef.current = null
    }
    hostSplitCleanupRef.current = cleanup
    return cleanup
  }, [anchorRef, currentViewportWidth])

  useLayoutEffect(() => {
    hostSplitRef.current?.layout.frame.style.setProperty(HOST_DRAWER_TRACK_PROPERTY, drawerTrack)
  }, [drawerTrack])

  useEffect(() => {
    const onResize = (): void => {
      setCurrentViewportWidth(viewportWidth())
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || window.innerWidth <= MOBILE_BREAKPOINT) return
      const startRatio = drawerRatio ?? DRAWER_DEFAULT_RATIO
      resizeDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: viewportWidth() * startRatio,
        currentRatio: startRatio,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setIsResizing(true)
      event.preventDefault()
    },
    [drawerRatio],
  )

  const onResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const next = clampDrawerRatio((drag.startWidth + drag.startX - event.clientX) / viewportWidth())
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

  const onResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
    },
    [drawerRatio],
  )

  const resetDrawerWidth = useCallback(() => {
    hostSplitRef.current?.layout.frame.style.setProperty(
      HOST_DRAWER_TRACK_PROPERTY,
      drawerTrackForRatio(DRAWER_DEFAULT_RATIO),
    )
    setDrawerRatio(null)
    persistDrawerRatio(null)
  }, [])

  const drawerStyle =
    drawerRatio === null
      ? undefined
      : ({
          '--review-drawer-width': `${Number((drawerRatio * 100).toFixed(2))}vw`,
        } as CSSProperties)
  const effectiveDrawerWidth = Math.round(currentViewportWidth * effectiveDrawerRatio)

  return (
    <aside
      className={`${css.drawer} ${isHostSplit ? css.drawerSplit : ''} ${isResizing ? css.drawerResizing : ''}`}
      style={drawerStyle}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-review-drawer=""
    >
      <div
        className={css.resizeHandle}
        role="separator"
        aria-label={contentProps.t('review.resize')}
        aria-orientation="vertical"
        aria-valuemin={Math.round(currentViewportWidth * DRAWER_MIN_RATIO)}
        aria-valuemax={Math.round(currentViewportWidth * DRAWER_MAX_RATIO)}
        aria-valuenow={effectiveDrawerWidth}
        tabIndex={0}
        title={contentProps.t('review.resizeHint')}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={onResizeKeyDown}
        onDoubleClick={resetDrawerWidth}
      />
      <ReviewContent
        {...contentProps}
        titleId={titleId}
        onClose={closeReview}
        closeButtonRef={closeButtonRef}
      />
    </aside>
  )
}
