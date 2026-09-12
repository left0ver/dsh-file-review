/** Review tab that resolves a lightweight target against the live Session timeline. */

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Config } from '../settings-contract.ts'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FileReviewRequest, FileReviewResult } from '../change-types.ts'
import { ReviewContent } from './ReviewContent.tsx'
import { reviewsForClosing } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

const EMPTY_SNAPSHOT = Symbol('empty file-review snapshot')

/** Navigation parameters for one turn's review material. */
export interface ReviewTarget {
  readonly turn: number
  readonly closingSeq: number
  readonly focusPaths: readonly string[]
}

export interface FileReviewTabRuntime {
  readonly inspectChanges: (request: FileReviewRequest) => Promise<FileReviewResult>
  readonly applyChanges: (request: FileReviewRequest) => Promise<FileReviewResult>
  readonly syncComments?: (() => void) | undefined
}

export interface FileReviewTabProps extends PropsLocale<typeof NS> {
  readonly sessions: ISessions
  readonly uiConversation: UiConversation
  readonly sessionId: SessionId
  readonly projectRoot?: string | undefined
  readonly params: unknown
  readonly visible: boolean
  readonly syncComments?: (() => void) | undefined
  readonly wordWrap: ObservableSnapshot<boolean>
  readonly settings?: SettingsScope<Config> | undefined
  readonly openFile: (path: string) => void
}

function reviewTargetFrom(value: unknown): ReviewTarget | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<Record<keyof ReviewTarget, unknown>>
  if (
    !Number.isInteger(candidate.turn) ||
    !Number.isInteger(candidate.closingSeq) ||
    !Array.isArray(candidate.focusPaths) ||
    !candidate.focusPaths.every((path): path is string => typeof path === 'string')
  ) {
    return undefined
  }
  return {
    turn: candidate.turn as number,
    closingSeq: candidate.closingSeq as number,
    focusPaths: candidate.focusPaths,
  }
}

/** Restore review data after first open, target changes, session switches and page reloads. */
export function FileReviewTab({
  sessions,
  uiConversation,
  sessionId,
  projectRoot,
  params,
  visible,
  syncComments,
  wordWrap,
  settings,
  openFile,
  t,
}: FileReviewTabProps) {
  const getSessionsSnapshot = useCallback(() => sessions.list.getSnapshot(), [sessions])
  const subscribeSessions = useCallback(
    (listener: () => void) => sessions.list.subscribe(listener),
    [sessions],
  )
  useSyncExternalStore(subscribeSessions, getSessionsSnapshot, getSessionsSnapshot)

  const binding = sessions.binding(sessionId)
  const chat = binding === undefined ? undefined : uiConversation.binding(binding).target('chat')
  const getChatSnapshot = useCallback(() => chat?.getSnapshot() ?? EMPTY_SNAPSHOT, [chat])
  const subscribeChat = useCallback(
    (listener: () => void) => (visible ? (chat?.subscribe(listener) ?? (() => {})) : () => {}),
    [chat, visible],
  )
  const snapshot = useSyncExternalStore(subscribeChat, getChatSnapshot, getChatSnapshot)
  const target = useMemo(() => reviewTargetFrom(params), [params])

  const reviews = useMemo(() => {
    if (target === undefined || snapshot === EMPTY_SNAPSHOT) return []
    const turn = snapshot.timeline.turns.get(target.turn)
    const available = reviewsForClosing(turn?.data.get('deliverables'), target.closingSeq)
    if (target.focusPaths.length === 0) return available
    const focused = new Set(target.focusPaths)
    return available.filter((review) => focused.has(review.path))
  }, [snapshot, target])

  if (target === undefined) {
    return (
      <div className={css.sidebarTabEmpty} role="status">
        {t('review.sidebarTargetUnavailable')}
      </div>
    )
  }
  if (snapshot === EMPTY_SNAPSHOT) {
    return (
      <div className={css.sidebarTabEmpty} role="status">
        {t('review.sidebarSessionUnavailable')}
      </div>
    )
  }
  if (reviews.length === 0) {
    return (
      <div className={css.sidebarTabEmpty} role="status">
        {t('review.sidebarDataUnavailable')}
      </div>
    )
  }

  return (
    <div className={css.sidebarTab} data-file-review-sidebar-tab="">
      <ReviewContent
        reviews={reviews}
        projectRoot={projectRoot}
        sessionId={sessionId}
        turn={target.turn}
        closingSeq={target.closingSeq}
        openFile={openFile}
        syncComments={syncComments}
        wordWrap={wordWrap}
        settings={settings}
        visible={visible}
        t={t}
      />
    </div>
  )
}
