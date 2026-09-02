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
      clipboardText: () => '@review-comments',
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

  const sync = (): void => {
    if (reconciling) return
    let state = input.state.getSnapshot()
    if (state.phase !== 'plain') return
    const count = reviewComments(sessionId).length
    const current = occurrenceFor(state, sessionId)
    const expectedLabel =
      count === 0
        ? undefined
        : count === 1
          ? t('review.commentCountOne')
          : t('review.commentCount', { count: String(count) })
    if (current !== undefined && count > 0 && current.label === expectedLabel) return

    reconciling = true
    try {
      if (current !== undefined) {
        const end = current.offset + current.length
        const removeEnd = state.draft[end] === ' ' ? end + 1 : end
        input.setDraft(state.draft.slice(0, current.offset) + state.draft.slice(removeEnd))
        state = input.state.getSnapshot()
      }
      if (count === 0 || expectedLabel === undefined || state.phase !== 'plain') return
      scope.bail(scope, 'slash/input-insert-reference', {
        reference: {
          source: REVIEW_COMMENT_SOURCE,
          ref: sessionId,
          label: expectedLabel,
          clipboardText: '@review-comments',
        },
        span: { start: 0, end: 0, draftRev: state.draftRev },
      })
    } finally {
      reconciling = false
    }
  }

  const unsubscribe = input.state.subscribe(() => {
    if (reconciling) return
    const state = input.state.getSnapshot()
    if (state.phase === 'plain') sync()
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
      unsubscribeComments()
      unsubscribeEvents()
      unsubscribe()
    },
  }
}
