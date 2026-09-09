// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  SessionEventSource,
  SessionLiveEventEntry,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { bindReviewReference, REVIEW_COMMENT_SOURCE } from '../src/client/review-reference.ts'
import {
  clearAllReviewComments,
  clearReviewComments,
  reviewComments,
  setReviewComment,
} from '../src/client/review-comments.ts'
import { en } from '../src/client/locales.ts'

const REVIEW_REFERENCE = '@review-comments'

class FakeEventSource implements SessionEventSource {
  private readonly listeners = new Set<() => void>()
  private snapshot: ReturnType<SessionEventSource['getSnapshot']> = {
    entries: [],
    hasMore: false,
    revision: 0,
    change: { kind: 'replace', entries: [] },
  }

  getSnapshot(): ReturnType<SessionEventSource['getSnapshot']> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  append(entry: SessionLiveEventEntry): void {
    this.snapshot = {
      entries: [...this.snapshot.entries, entry],
      hasMore: false,
      revision: this.snapshot.revision + 1,
      change: { kind: 'append', entries: [entry] },
    }
    for (const listener of this.listeners) listener()
  }
}

function eventSource(): FakeEventSource {
  return new FakeEventSource()
}

function userMessage(text: string): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      type: 'user/message',
      seq: 1,
      time: 1,
      data: {
        role: 'user',
        id: 'message-1',
        source: { kind: 'user' },
        content: [{ type: 'text', text }],
      },
      surfaceOp: 'append',
    },
  } as SessionLiveEventEntry
}

function t(key: keyof typeof en, params?: Record<string, unknown>): string {
  let value: string = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}

class FakeInput {
  snapshot = {
    draft: '',
    draftRev: 0,
    phase: 'plain' as 'plain' | 'adjudicating' | 'claimed' | 'submitting',
    occurrences: [] as Array<{
      source: string
      ref: string
      label: string
      offset: number
      length: number
      clipboardText: string
    }>,
  }

  private readonly listeners = new Set<() => void>()

  readonly state = {
    getSnapshot: () => this.snapshot,
    subscribe: (listener: () => void) => {
      this.listeners.add(listener)
      return () => {
        this.listeners.delete(listener)
      }
    },
  }

  setDraft(text: string): void {
    this.snapshot = {
      ...this.snapshot,
      draft: text,
      occurrences: [],
      draftRev: this.snapshot.draftRev + 1,
    }
    this.emit()
  }

  type(text: string): void {
    this.snapshot = {
      ...this.snapshot,
      draft: text,
      occurrences: this.snapshot.occurrences.map((value) => ({
        ...value,
        offset: text.indexOf(value.clipboardText),
      })),
      draftRev: this.snapshot.draftRev + 1,
    }
    this.emit()
  }

  insert(
    reference: { source: string; ref: string; label: string; clipboardText?: string },
    start: number,
  ): void {
    const clipboardText = reference.clipboardText ?? REVIEW_REFERENCE
    this.snapshot = {
      ...this.snapshot,
      draft: this.snapshot.draft.slice(0, start) + clipboardText + this.snapshot.draft.slice(start),
      draftRev: this.snapshot.draftRev + 1,
      occurrences: [{ ...reference, clipboardText, offset: start, length: clipboardText.length }],
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
    sessionId: 'session-1',
    turn: 2,
    closingSeq: 9,
    body,
    anchor: {
      path: 'src/a.ts',
      hunkIndex: 0,
      rowIndex,
      kind: 'add' as const,
      oldLine: null,
      newLine: rowIndex + 1,
      text: `line ${rowIndex}`,
      excerpt: `+ line ${rowIndex}`,
    },
  }
}

afterEach(() => {
  clearAllReviewComments()
})

describe('review comment composer reference', () => {
  it('isolates in-memory comments by session', () => {
    setReviewComment(comment(0, 'First session'))
    setReviewComment({ ...comment(1, 'Second session'), sessionId: 'session-2' })
    expect(reviewComments('session-1').map((value) => value.body)).toEqual(['First session'])
    expect(reviewComments('session-2').map((value) => value.body)).toEqual(['Second session'])
    clearReviewComments('session-1')
    expect(reviewComments('session-1')).toHaveLength(0)
    expect(reviewComments('session-2')).toHaveLength(1)
  })

  it('aggregates comments into one leading reference without replacing the question', () => {
    const input = new FakeInput()
    let inserts = 0
    const scope = {
      bail: (
        _subject: unknown,
        event: string,
        payload: {
          reference: { source: string; ref: string; label: string }
          span: { start: number }
        },
      ) => {
        if (event === 'slash/input-insert-reference') {
          inserts += 1
          input.insert(payload.reference, payload.span.start)
        }
        return true
      },
    } as unknown as ClientContext

    setReviewComment(comment(0, 'First'))
    const events = eventSource()
    const binding = bindReviewReference(scope, 'session-1', input, t, events)
    expect(input.snapshot.draft).toBe(REVIEW_REFERENCE)
    expect(input.snapshot.occurrences[0]?.label).toBe('1 comment')

    input.type(`${REVIEW_REFERENCE} Please fix these.`)
    setReviewComment(comment(1, 'Second'))
    binding.sync()
    expect(input.snapshot.draft).toBe(`${REVIEW_REFERENCE}Please fix these.`)
    expect(input.snapshot.occurrences).toEqual([
      expect.objectContaining({
        source: REVIEW_COMMENT_SOURCE,
        label: '2 comments',
        offset: 0,
      }),
    ])
    expect(inserts).toBe(2)

    input.transition('plain', true)
    expect(reviewComments('session-1')).toHaveLength(2)
    expect(input.snapshot.occurrences).toHaveLength(1)
    events.append(userMessage('<file_review_comments>sent</file_review_comments>'))
    expect(reviewComments('session-1')).toHaveLength(0)
    expect(input.snapshot.draft).toBe('')
    expect(input.snapshot.occurrences).toHaveLength(0)
    binding.dispose()
  })

  it('keeps comments and restores the reference when submission does not clear the draft', () => {
    const input = new FakeInput()
    const scope = {
      bail: (
        _subject: unknown,
        _event: string,
        payload: {
          reference: { source: string; ref: string; label: string }
          span: { start: number }
        },
      ) => {
        input.insert(payload.reference, payload.span.start)
        return true
      },
    } as unknown as ClientContext
    setReviewComment(comment(0, 'Still pending'))
    const events = eventSource()
    const binding = bindReviewReference(scope, 'session-1', input, t, events)
    input.transition('plain', true)
    events.append(userMessage('An unrelated message'))
    expect(reviewComments('session-1')).toHaveLength(1)
    expect(input.snapshot.occurrences).toHaveLength(1)
    binding.dispose()
  })

  it('removes the serialized review reference after a successful submission', () => {
    const input = new FakeInput()
    const scope = {
      bail: (
        _subject: unknown,
        _event: string,
        payload: {
          reference: { source: string; ref: string; label: string }
          span: { start: number }
        },
      ) => {
        input.insert(payload.reference, payload.span.start)
        return true
      },
    } as unknown as ClientContext
    setReviewComment(comment(0, 'Sent'))
    const events = eventSource()
    const binding = bindReviewReference(scope, 'session-1', input, t, events)

    input.type(`${REVIEW_REFERENCE}Question`)
    input.transition('plain', true)
    events.append(userMessage('<file_review_comments>sent</file_review_comments>'))

    expect(input.snapshot.draft).toBe('')
    binding.dispose()
  })
})
