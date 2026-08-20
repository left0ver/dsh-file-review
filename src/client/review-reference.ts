/** Composer reference bridge for aggregate session review comments. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import {
  clearReviewComments, reviewComments, serializeReviewComments, subscribeReviewComments,
} from './review-comments.ts'

export const REVIEW_COMMENT_SOURCE = 'file-review-comments'
export const REVIEW_COMMENT_HIDDEN_LABEL = '\u200B'

interface ReviewOccurrence {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly offset: number
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
    occurrence => occurrence.source === REVIEW_COMMENT_SOURCE && occurrence.ref === sessionId,
  )
}

/** Register the reference codec used by the programmatically inserted aggregate chip. */
export function reviewCommentSource(): InputTriggerSource {
  return {
    trigger: '@',
    name: REVIEW_COMMENT_SOURCE,
    order: 100,
    async candidates() { return [] },
    onPick() { return undefined },
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
  _t: TranslateNS<typeof NS>,
): { readonly sync: () => void; readonly dispose: () => void } {
  let reconciling = false
  let submittedWithReference = false

  const sync = (): void => {
    if (reconciling) return
    let state = input.state.getSnapshot()
    if (state.phase !== 'plain') return
    const count = reviewComments(sessionId).length
    const current = occurrenceFor(state, sessionId)
    const expectedLabel = count > 0 ? REVIEW_COMMENT_HIDDEN_LABEL : undefined
    if (current !== undefined && count > 0 && current.label === expectedLabel) return

    reconciling = true
    try {
      if (current !== undefined) {
        const removeEnd = state.draft[current.offset + 1] === ' '
          ? current.offset + 2
          : current.offset + 1
        input.setDraft(
          state.draft.slice(0, current.offset) + state.draft.slice(removeEnd),
        )
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
    const hasReference = occurrenceFor(state, sessionId) !== undefined
    if (state.phase === 'submitting' && hasReference) submittedWithReference = true
    if (submittedWithReference && state.phase === 'plain') {
      submittedWithReference = false
      if (!hasReference && state.draft === '') clearReviewComments(sessionId)
    }
    if (state.phase === 'plain') sync()
  })
  const unsubscribeComments = subscribeReviewComments(sessionId, sync)

  sync()
  return {
    sync,
    dispose: () => {
      unsubscribeComments()
      unsubscribe()
    },
  }
}
