// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  bindReviewReference, REVIEW_COMMENT_HIDDEN_LABEL, REVIEW_COMMENT_SOURCE,
} from '../src/client/review-reference.ts'
import {
  clearAllReviewComments, clearReviewComments, reviewComments, setReviewComment,
} from '../src/client/review-comments.ts'
import { en } from '../src/client/locales.ts'

const PLACEHOLDER = '\uFFFC'

function t(key: keyof typeof en, params?: Record<string, unknown>): string {
  let value: string = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}

class FakeInput {
  snapshot = {
    draft: '', draftRev: 0,
    phase: 'plain' as 'plain' | 'adjudicating' | 'claimed' | 'submitting',
    occurrences: [] as Array<{
      source: string; ref: string; label: string; offset: number
    }>,
  }

  private readonly listeners = new Set<() => void>()

  readonly state = {
    getSnapshot: () => this.snapshot,
    subscribe: (listener: () => void) => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }

  setDraft(text: string): void {
    const occurrences = text.includes(PLACEHOLDER)
      ? this.snapshot.occurrences.map(value => ({ ...value, offset: text.indexOf(PLACEHOLDER) }))
      : []
    this.snapshot = { ...this.snapshot, draft: text, occurrences, draftRev: this.snapshot.draftRev + 1 }
    this.emit()
  }

  insert(reference: { source: string; ref: string; label: string }, start: number): void {
    this.snapshot = {
      ...this.snapshot,
      draft: this.snapshot.draft.slice(0, start) + PLACEHOLDER + this.snapshot.draft.slice(start),
      draftRev: this.snapshot.draftRev + 1,
      occurrences: [{ ...reference, offset: start }],
    }
    this.emit()
  }

  transition(phase: FakeInput['snapshot']['phase'], clear = false): void {
    this.snapshot = {
      ...this.snapshot,
      phase,
      ...(clear ? { draft: '', occurrences: [] } : {}),
    }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

function comment(rowIndex: number, body: string) {
  return {
    sessionId: 'session-1', turn: 2, closingSeq: 9, body,
    anchor: {
      path: 'src/a.ts', hunkIndex: 0, rowIndex, kind: 'add' as const,
      oldLine: null, newLine: rowIndex + 1, text: `line ${rowIndex}`,
      excerpt: `+ line ${rowIndex}`,
    },
  }
}

afterEach(() => { clearAllReviewComments() })

describe('review comment composer reference', () => {
  it('isolates in-memory comments by session', () => {
    setReviewComment(comment(0, 'First session'))
    setReviewComment({ ...comment(1, 'Second session'), sessionId: 'session-2' })
    expect(reviewComments('session-1').map(value => value.body)).toEqual(['First session'])
    expect(reviewComments('session-2').map(value => value.body)).toEqual(['Second session'])
    clearReviewComments('session-1')
    expect(reviewComments('session-1')).toHaveLength(0)
    expect(reviewComments('session-2')).toHaveLength(1)
  })

  it('aggregates comments into one leading reference without replacing the question', () => {
    const input = new FakeInput()
    let inserts = 0
    const scope = {
      bail: (_subject: unknown, event: string, payload: {
        reference: { source: string; ref: string; label: string }
        span: { start: number }
      }) => {
        if (event === 'slash/input-insert-reference') {
          inserts += 1
          input.insert(payload.reference, payload.span.start)
        }
        return true
      },
    } as unknown as ClientContext

    setReviewComment(comment(0, 'First'))
    const binding = bindReviewReference(scope, 'session-1', input, t)
    expect(input.snapshot.draft).toBe(PLACEHOLDER)
    expect(input.snapshot.occurrences[0]?.label).toBe(REVIEW_COMMENT_HIDDEN_LABEL)

    input.setDraft(`${PLACEHOLDER}Please fix these.`)
    setReviewComment(comment(1, 'Second'))
    binding.sync()
    expect(input.snapshot.draft).toBe(`${PLACEHOLDER}Please fix these.`)
    expect(input.snapshot.occurrences).toEqual([expect.objectContaining({
      source: REVIEW_COMMENT_SOURCE,
      label: REVIEW_COMMENT_HIDDEN_LABEL,
      offset: 0,
    })])
    expect(inserts).toBe(1)

    input.transition('submitting')
    input.transition('plain', true)
    expect(reviewComments('session-1')).toHaveLength(0)
    binding.dispose()
  })

  it('keeps comments and restores the reference when submission does not clear the draft', () => {
    const input = new FakeInput()
    const scope = {
      bail: (_subject: unknown, _event: string, payload: {
        reference: { source: string; ref: string; label: string }
        span: { start: number }
      }) => { input.insert(payload.reference, payload.span.start); return true },
    } as unknown as ClientContext
    setReviewComment(comment(0, 'Still pending'))
    const binding = bindReviewReference(scope, 'session-1', input, t)
    input.transition('submitting')
    input.transition('plain')
    expect(reviewComments('session-1')).toHaveLength(1)
    expect(input.snapshot.occurrences).toHaveLength(1)
    binding.dispose()
  })
})
