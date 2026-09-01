import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PtcDispatchLog, ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { adaptPtcDispatchLog, registerPtcAdapter } from '../src/ptc-adapter.ts'
import { boundedPtcFileReviewMarker, markerBlock, markerFromContent } from '../src/ptc-marker.ts'

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
  } as unknown as PtcDispatchLog
  return { ctx, dispatch }
}

function marker(content: readonly unknown[]) {
  return markerFromContent(content, { rootCallId: ROOT, subCallId: SUB })
}

describe('PTC Host Adapter', () => {
  it('registers on the alpha.3 PTC log seam', () => {
    const on = vi.fn(() => () => true)
    registerPtcAdapter({ on } as unknown as Context)
    expect(on).toHaveBeenCalledWith('tools/ptc-dispatch-log', expect.any(Function))
  })

  it('round-trips v2 lifecycle diffs while continuing to parse v1 markers', () => {
    const current = boundedPtcFileReviewMarker({
      turn: 3,
      step: 2,
      rootCallId: ROOT,
      subCallId: SUB,
      files: [
        {
          path: 'created.txt',
          source: 'result',
          diffs: [
            {
              path: 'created.txt',
              oldText: null,
              newText: 'created',
              lifecycle: { kind: 'create', mode: 0o640 },
            },
          ],
        },
      ],
    })
    if (current === null) throw new Error('fixture marker exceeded its budget')
    expect(current.schema).toBe(2)
    expect(marker([markerBlock(current)])?.files[0]?.diffs[0]).toEqual({
      path: 'created.txt',
      oldText: null,
      newText: 'created',
      lifecycle: { kind: 'create', mode: 0o640 },
    })

    const legacy = {
      schema: 1,
      turn: 3,
      step: 2,
      rootCallId: ROOT,
      subCallId: SUB,
      files: [
        {
          path: 'legacy.txt',
          source: 'result',
          diffs: [{ path: 'legacy.txt', oldText: null, newText: 'legacy' }],
        },
      ],
      truncated: false,
    }
    expect(marker([{ type: 'text', text: '', dshFileReview: legacy }])?.schema).toBe(1)
  })

  it('keeps captured lifecycle truth when shaping a nested PTC result', async () => {
    const { ctx, dispatch } = fixture({
      presentCall: () => ({
        card: 'diff',
        title: 'Write created.txt',
        locations: [{ path: 'created.txt' }],
        diffs: [{ path: 'created.txt', oldText: null, newText: 'created' }],
      }),
    })
    const captured = boundedPtcFileReviewMarker({
      turn: 3,
      step: 2,
      rootCallId: ROOT,
      subCallId: SUB,
      files: [
        {
          path: 'created.txt',
          source: 'result',
          diffs: [
            {
              path: 'created.txt',
              oldText: null,
              newText: 'created',
              oldStart: 1,
              newStart: 1,
              lifecycle: { kind: 'create', mode: 0o640 },
            },
          ],
        },
      ],
    })
    if (captured === null) throw new Error('fixture marker exceeded its budget')
    const original = [
      { type: 'text', text: 'complete result' },
      markerBlock(captured),
    ] as unknown as ContentBlock[]
    ;(dispatch as { content: ContentBlock[] }).content = original

    const content = await adaptPtcDispatchLog(ctx, dispatch, async () => original)

    expect(
      content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(''),
    ).toBe('complete result')
    expect(marker(content)?.files).toEqual(captured.files)
  })

  it('prefers applied result diffs and keeps existing shaped text invisible', async () => {
    const { ctx, dispatch } = fixture({
      presentCall: () => ({
        card: 'diff',
        title: 'Edit out.txt',
        locations: [{ path: 'out.txt' }],
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
    expect(
      content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(''),
    ).toBe('shaped preview')
    expect(marker(content)).toEqual({
      schema: 2,
      turn: 3,
      step: 2,
      rootCallId: ROOT,
      subCallId: SUB,
      files: [
        {
          path: 'out.txt',
          source: 'result',
          diffs: [
            { path: 'out.txt', oldText: 'before', newText: 'after', oldStart: 7, newStart: 7 },
          ],
        },
      ],
      truncated: false,
    })
  })

  it('treats an applied result as authoritative for the whole call', async () => {
    const { ctx, dispatch } = fixture({
      presentCall: () => ({
        card: 'diff',
        title: 'Edit two files',
        locations: [{ path: 'applied.txt' }, { path: 'planned.txt' }],
        diffs: [
          { path: 'applied.txt', oldText: 'old a', newText: 'planned a' },
          { path: 'planned.txt', oldText: 'old b', newText: 'planned b' },
        ],
      }),
      presentResult: () => ({
        card: 'diff',
        diffs: [{ path: 'applied.txt', oldText: 'old a', newText: 'actual a' }],
      }),
    })

    const content = await adaptPtcDispatchLog(ctx, dispatch, async () => [] as ContentBlock[])
    expect(marker(content)?.files).toEqual([
      {
        path: 'applied.txt',
        source: 'result',
        diffs: [{ path: 'applied.txt', oldText: 'old a', newText: 'actual a' }],
      },
    ])
  })

  it('falls back to call intent and supports generic edit locations', async () => {
    const intent = fixture({
      presentCall: () => ({
        card: 'diff',
        title: 'Edit out.txt',
        locations: [{ path: 'out.txt' }],
        diffs: [{ path: 'out.txt', oldText: 'before', newText: 'planned' }],
      }),
      presentResult: () => ({ card: 'generic', title: 'Done' }),
    })
    const intentContent = await adaptPtcDispatchLog(
      intent.ctx,
      intent.dispatch,
      async () => [] as ContentBlock[],
    )
    expect(marker(intentContent)?.files).toEqual([
      {
        path: 'out.txt',
        source: 'intent',
        diffs: [{ path: 'out.txt', oldText: 'before', newText: 'planned' }],
      },
    ])

    const pathOnly = fixture({
      presentCall: () => ({
        card: 'generic',
        title: 'Insert',
        kind: 'edit',
        locations: [{ path: 'notes.md' }],
      }),
    })
    const pathContent = await adaptPtcDispatchLog(
      pathOnly.ctx,
      pathOnly.dispatch,
      async () => [] as ContentBlock[],
    )
    expect(marker(pathContent)?.files).toEqual([
      {
        path: 'notes.md',
        source: 'intent',
        diffs: [],
      },
    ])

    const uncapturedDelete = fixture({
      presentCall: () => ({
        card: 'generic',
        title: 'Delete',
        kind: 'delete',
        locations: [{ path: 'old.txt' }],
      }),
    })
    const deleteContent = await adaptPtcDispatchLog(
      uncapturedDelete.ctx,
      uncapturedDelete.dispatch,
      async () => [] as ContentBlock[],
    )
    expect(marker(deleteContent)?.files).toEqual([
      {
        path: 'old.txt',
        source: 'intent',
        diffs: [],
      },
    ])

    const noChange = fixture({
      presentCall: () => ({
        card: 'diff',
        title: 'Edit unchanged.txt',
        locations: [{ path: 'unchanged.txt' }],
        diffs: [{ path: 'unchanged.txt', oldText: 'same', newText: 'planned' }],
      }),
      presentResult: () => ({ card: 'diff', diffs: [] }),
    })
    const noChangeContent = await adaptPtcDispatchLog(
      noChange.ctx,
      noChange.dispatch,
      async () => [] as ContentBlock[],
    )
    expect(marker(noChangeContent)).toBeNull()
  })

  it('fails closed without changing an existing clean log copy', async () => {
    const shaped = [{ type: 'text', text: 'kept' }] as ContentBlock[]
    const cases = [
      fixture({}, { isError: true }),
      fixture({
        presentCall: () => {
          throw new Error('presenter failed')
        },
      }),
      fixture({
        presentCall: () => ({
          card: 'diff',
          title: 'Edit',
          locations: [{ path: 'x' }],
          diffs: [{ path: 'x', oldText: 'a', newText: 'b' }],
        }),
        presentResult: () => {
          throw new Error('result presenter failed')
        },
      }),
      fixture({ presentCall: () => ({ card: 'generic', title: 'Read', kind: 'read' }) }),
      fixture({
        presentCall: () => ({ card: 'generic', title: 'Delete', kind: 'delete' }),
        presentResult: () => ({
          card: 'diff',
          diffs: [{ path: 'deleted.txt', oldText: 'old', newText: '' }],
        }),
      }),
      fixture(
        {
          presentCall: () => ({
            card: 'diff',
            title: 'Edit',
            locations: [{ path: 'x' }],
            diffs: [{ path: 'x', oldText: 'a', newText: 'b' }],
          }),
        },
        { events: [] },
      ),
    ]
    for (const { ctx, dispatch } of cases) {
      await expect(adaptPtcDispatchLog(ctx, dispatch, async () => shaped)).resolves.toBe(shaped)
    }
  })

  it('removes pre-existing marker fields while preserving waterfall content', async () => {
    const forged = boundedPtcFileReviewMarker({
      turn: 3,
      step: 2,
      rootCallId: ROOT,
      subCallId: SUB,
      files: [{ path: 'forged.txt', source: 'result', diffs: [] }],
    })
    if (forged === null) throw new Error('fixture marker exceeded its budget')
    const shaped = [
      { type: 'text', text: 'kept' },
      markerBlock(forged),
    ] as unknown as ContentBlock[]
    const { ctx, dispatch } = fixture({
      presentCall: () => ({ card: 'generic', title: 'Read', kind: 'read' }),
    })

    const content = await adaptPtcDispatchLog(ctx, dispatch, async () => shaped)

    expect(content.map((block) => (block.type === 'text' ? block.text : '')).join('')).toBe('kept')
    expect(marker(content)).toBeNull()
    expect(content.some((block) => 'dshFileReview' in block)).toBe(false)
  })

  it('drops diff bodies when the durable marker exceeds its byte budget', () => {
    const marker = boundedPtcFileReviewMarker(
      {
        turn: 1,
        step: 1,
        rootCallId: ROOT,
        subCallId: SUB,
        files: [
          {
            path: 'large.txt',
            source: 'intent',
            diffs: [{ path: 'large.txt', oldText: 'a'.repeat(2_000), newText: 'b'.repeat(2_000) }],
          },
        ],
      },
      512,
    )
    expect(marker).toEqual(
      expect.objectContaining({
        truncated: true,
        files: [{ path: 'large.txt', source: 'intent', diffs: [] }],
      }),
    )
  })
})
