/** Composer reference bridge for aggregate session review comments. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import {
  clearReviewComments,
  reviewComments,
  serializeReviewComments,
  subscribeReviewComments,
} from './review-comments.ts'

export const REVIEW_COMMENT_SOURCE = 'file-review-comments'

/** Plain-text form of the chip; the host writes it when it rebuilds a draft from text. */
const REVIEW_COMMENT_TEXT = '@review-comments'

interface ReviewOccurrence {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly offset: number
  readonly length: number
}

interface ReviewInputState {
  readonly draft: string
  readonly draftRev: number
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  readonly occurrences: readonly ReviewOccurrence[]
}

export interface ReviewInput {
  readonly state: {
    getSnapshot(): ReviewInputState
    subscribe(listener: () => void): () => void
  }
  setDraft(text: string): void
}

function occurrenceFor(state: ReviewInputState, sessionId: string): ReviewOccurrence | undefined {
  return state.occurrences.find(
    (occurrence) => occurrence.source === REVIEW_COMMENT_SOURCE && occurrence.ref === sessionId,
  )
}

/** Register the reference codec used by the programmatically inserted aggregate chip. */
export function reviewCommentSource(): InputTriggerSource {
  return {
    trigger: '@',
    name: REVIEW_COMMENT_SOURCE,
    order: 100,
    async candidates() {
      return []
    },
    onPick() {
      return undefined
    },
    codec: {
      clipboardText: () => REVIEW_COMMENT_TEXT,
      async serialize(ref, signal) {
        if (signal.aborted) throw signal.reason
        return `${serializeReviewComments(ref)}\n\n`
      },
    },
  }
}

/**
 * Keep exactly one aggregate comment occurrence at the beginning of the draft.
 * The returned disposer owns only its input subscription; comments remain in
 * the session repository until a confirmed send or plugin disposal.
 */
export function bindReviewReference(
  scope: ClientContext,
  sessionId: string,
  input: ReviewInput,
  t: TranslateNS<typeof NS>,
  events: SessionEventSource,
): { readonly sync: () => void; readonly dispose: () => void } {
  let reconciling = false
  let syncScheduled = false
  let disposed = false

  const sync = (): void => {
    if (reconciling) return
    let state = input.state.getSnapshot()
    if (state.phase !== 'plain') return
    const count = reviewComments(sessionId).length
    const current = occurrenceFor(state, sessionId)
    // 宿主用纯文本重建草稿（如会话重新挂载时恢复已保存草稿）会把 chip 压平成字面文字。
    const flattened =
      current === undefined &&
      state.draft.startsWith(REVIEW_COMMENT_TEXT) &&
      !state.occurrences.some((occurrence) => occurrence.offset === 0)
        ? REVIEW_COMMENT_TEXT.length
        : 0
    const expectedLabel =
      count === 0
        ? undefined
        : count === 1
          ? t('review.commentCountOne')
          : t('review.commentCount', { count: String(count) })
    if (
      current !== undefined &&
      count > 0 &&
      current.label === expectedLabel &&
      current.offset === 0
    )
      return
    if (current === undefined && count === 0 && flattened === 0) return

    reconciling = true
    try {
      let caretAfterPrefix: number | undefined
      if (current !== undefined) {
        const end = current.offset + current.length
        const hasSeparator = state.draft[end] === ' '
        if (current.offset > 0) {
          // DSH 的 detect 坐标中每个引用占一个位置。
          const detectStart =
            current.offset -
            state.occurrences
              .filter((occurrence) => occurrence.offset < current.offset)
              .reduce((length, occurrence) => length + occurrence.length - 1, 0)
          const removed = scope.bail(scope, 'slash/input-insert-text', {
            text: '',
            span: {
              start: detectStart,
              end: detectStart + (hasSeparator ? 2 : 1),
              draftRev: state.draftRev,
            },
          })
          if (removed !== true) throw new Error('Failed to move review comment reference')
          caretAfterPrefix = detectStart
        } else {
          const removeEnd = hasSeparator ? end + 1 : end
          input.setDraft(state.draft.slice(0, current.offset) + state.draft.slice(removeEnd))
        }
        state = input.state.getSnapshot()
      }
      if (flattened > 0 && count === 0) {
        const end = flattened + (state.draft[flattened] === ' ' ? 1 : 0)
        const removed = scope.bail(scope, 'slash/input-insert-text', {
          text: '',
          span: { start: 0, end, draftRev: state.draftRev },
        })
        if (removed !== true) throw new Error('Failed to remove stale review comment reference')
        return
      }
      if (count === 0 || expectedLabel === undefined || state.phase !== 'plain') return
      // 压平的字面文字位于开头，detect 坐标与字符一一对应，直接原地替换回 chip。
      const inserted = scope.bail(scope, 'slash/input-insert-reference', {
        reference: {
          source: REVIEW_COMMENT_SOURCE,
          ref: sessionId,
          label: expectedLabel,
          clipboardText: REVIEW_COMMENT_TEXT,
        },
        span: { start: 0, end: flattened, draftRev: state.draftRev },
      })
      if (inserted !== true) throw new Error('Failed to insert review comment reference')
      if (caretAfterPrefix !== undefined) {
        state = input.state.getSnapshot()
        // 新引用与后续空格各占一个 detect 位置。
        const caret = caretAfterPrefix + 2
        const positioned = scope.bail(scope, 'slash/input-insert-text', {
          text: '',
          span: { start: caret, end: caret, draftRev: state.draftRev },
        })
        if (positioned !== true) throw new Error('Failed to position review comment caret')
      }
    } finally {
      reconciling = false
    }
  }

  const unsubscribe = input.state.subscribe(() => {
    if (reconciling) return
    const state = input.state.getSnapshot()
    if (state.phase !== 'plain') return
    if ((occurrenceFor(state, sessionId)?.offset ?? 0) === 0) {
      sync()
      return
    }
    if (syncScheduled) return
    // 等输入组件完成状态通知，再按新的 draftRev 调整引用位置。
    syncScheduled = true
    queueMicrotask(() => {
      syncScheduled = false
      if (!disposed) sync()
    })
  })
  const unsubscribeEvents = events.subscribe(() => {
    const change = events.getSnapshot().change
    if (
      change.kind === 'append' &&
      change.entries.some(
        ({ event }) =>
          event.type === 'user/message' &&
          event.data.source.kind === 'user' &&
          event.data.content.some(
            (part) => part.type === 'text' && part.text.includes('<file_review_comments>'),
          ),
      )
    ) {
      clearReviewComments(sessionId)
    }
  })
  const unsubscribeComments = subscribeReviewComments(sessionId, sync)

  sync()
  return {
    sync,
    dispose: () => {
      disposed = true
      unsubscribeComments()
      unsubscribeEvents()
      unsubscribe()
    },
  }
}
