import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { CodeDispatchLog, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { adaptPtcDispatchLog } from '../src/ptc-adapter.ts'
import {
  boundedPtcFileReviewMarker, markerFromContent,
} from '../src/ptc-marker.ts'

const ROOT = 'root-call'
const SUB = 'root-call:code:0'

function event(seq: number, type: string, data: unknown) {
  return { seq, time: seq * 100, type, data }
}

function fixture(
  definition: Partial<ToolDefinition>,
  options: { readonly events?: readonly unknown[]; readonly isError?: boolean } = {},
) {
  const events = options.events ?? [
    event(0, 'tool/call', { turn: 3, step: 2, callId: ROOT, name: 'run_code', arguments: '{}' }),
    event(1, 'tool/code-dispatch-start', {
      rootCallId: ROOT,
      parentCallId: ROOT,
      subCallId: SUB,
      name: 'fixture',
      arguments: { path: 'out.txt' },
    }),
  ]
  const agent = { session: { events } }
  const ctx = {
    tools: { get: vi.fn(() => definition) },
  } as unknown as Context
  const dispatch = {
    exec: { rootCallId: ROOT },
    agent,
    subCallId: SUB,
    name: 'fixture',
    isError: options.isError ?? false,
    content: [{ type: 'text', text: 'complete result' }],
  } as unknown as CodeDispatchLog
  return { ctx, dispatch }
}

function marker(content: readonly unknown[]) {
  return markerFromContent(content, { rootCallId: ROOT, subCallId: SUB })
}

describe('PTC Host Adapter', () => {
  it('prefers applied result diffs and keeps existing shaped text invisible', async () => {
    const { ctx, dispatch } = fixture({
      presentCall: () => ({
        card: 'diff', title: 'Edit out.txt', locations: [{ path: 'out.txt' }],
        diffs: [{ path: 'out.txt', oldText: 'planned', newText: 'intent' }],
      }),
      presentResult: () => ({
        card: 'diff',
        diffs: [{ path: 'out.txt', oldText: 'before', newText: 'after', oldStart: 7, newStart: 7 }],
      }),
    })
    const next = vi.fn(async () => [{ type: 'text', text: 'shaped preview' }] as ContentBlock[])
    const content = await adaptPtcDispatchLog(ctx, dispatch, next)

    expect(next).toHaveBeenCalledOnce()
    expect(content.filter(block => block.type === 'text').map(block => block.text).join(''))
      .toBe('shaped preview')
    expect(marker(content)).toEqual({
      schema: 1,
      turn: 3,
      step: 2,
      rootCallId: ROOT,
      subCallId: SUB,
      files: [{
        path: 'out.txt', source: 'result',
        diffs: [{ path: 'out.txt', oldText: 'before', newText: 'after', oldStart: 7, newStart: 7 }],
      }],
      truncated: false,
    })
  })

  it('falls back to call intent and supports generic edit locations', async () => {
    const intent = fixture({
      presentCall: () => ({
        card: 'diff', title: 'Edit out.txt', locations: [{ path: 'out.txt' }],
        diffs: [{ path: 'out.txt', oldText: 'before', newText: 'planned' }],
      }),
      presentResult: () => ({ card: 'generic', title: 'Done' }),
    })
    const intentContent = await adaptPtcDispatchLog(
      intent.ctx, intent.dispatch, async () => [] as ContentBlock[],
    )
    expect(marker(intentContent)?.files).toEqual([{
      path: 'out.txt', source: 'intent',
      diffs: [{ path: 'out.txt', oldText: 'before', newText: 'planned' }],
    }])

    const pathOnly = fixture({
      presentCall: () => ({
        card: 'generic', title: 'Insert', kind: 'edit', locations: [{ path: 'notes.md' }],
      }),
    })
    const pathContent = await adaptPtcDispatchLog(
      pathOnly.ctx, pathOnly.dispatch, async () => [] as ContentBlock[],
    )
    expect(marker(pathContent)?.files).toEqual([{
      path: 'notes.md', source: 'intent', diffs: [],
    }])
  })

  it('fails closed without changing the existing log copy', async () => {
    const shaped = [{ type: 'text', text: 'kept' }] as ContentBlock[]
    const cases = [
      fixture({}, { isError: true }),
      fixture({ presentCall: () => { throw new Error('presenter failed') } }),
      fixture({ presentCall: () => ({ card: 'generic', title: 'Read', kind: 'read' }) }),
      fixture({ presentCall: () => ({
        card: 'diff', title: 'Edit', locations: [{ path: 'x' }],
        diffs: [{ path: 'x', oldText: 'a', newText: 'b' }],
      }) }, { events: [] }),
    ]
    for (const { ctx, dispatch } of cases) {
      await expect(adaptPtcDispatchLog(ctx, dispatch, async () => shaped)).resolves.toBe(shaped)
    }
  })

  it('drops diff bodies when the durable marker exceeds its byte budget', () => {
    const marker = boundedPtcFileReviewMarker({
      turn: 1,
      step: 1,
      rootCallId: ROOT,
      subCallId: SUB,
      files: [{
        path: 'large.txt',
        source: 'intent',
        diffs: [{ path: 'large.txt', oldText: 'a'.repeat(2_000), newText: 'b'.repeat(2_000) }],
      }],
    }, 512)
    expect(marker).toEqual(expect.objectContaining({
      truncated: true,
      files: [{ path: 'large.txt', source: 'intent', diffs: [] }],
    }))
  })
})
