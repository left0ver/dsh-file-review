// @vitest-environment jsdom
/**
 * dsh-file-review browser half: the derivation contract of
 * `producedForClosing` over engine-published Turn data, the row's rendering
 * and opener wiring, plus the plugin's public service registrations.
 */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { Context, Service } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ConversationLocationDataStore,
  ConversationMatch,
  ConversationTurnDataMap,
  TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatFileMentions, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { useMemo, useState } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ProducedFiles, type ProducedFilesProps } from '../src/client/ProducedFiles.tsx'
import {
  FileReviewSettingsCard,
  type FileReviewSettingsCardProps,
} from '../src/client/FileReviewSettingsCard.tsx'
import { FileReviewTab, type ReviewTarget } from '../src/client/FileReviewTab.tsx'
import {
  ReviewCommentsDock,
  type ReviewCommentsDockProps,
} from '../src/client/ReviewCommentsDock.tsx'
import { projectReviewMessageText, ReviewUserMessage } from '../src/client/ReviewUserMessage.tsx'
import { summarizeDiffs, unifiedDiffText } from '../src/client/UnifiedDiff.tsx'
import {
  clearAllReviewComments,
  reviewComments,
  serializeReviewComments,
  setReviewComment,
} from '../src/client/review-comments.ts'
import {
  basename,
  deliverablesDefinition,
  producedFileMentions,
  producedForClosing,
  reviewsForClosing,
  selectProducedFiles,
  type DeliverablesTurnData,
  type ProducedFileDiff,
  type ProducedFileReview,
} from '../src/client/turn-deliverables.ts'
import { boundedPtcFileReviewMarker, markerBlock } from '../src/ptc-marker.ts'
import { apply, inject } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

/** Supply the host-owned tab lifecycle while exercising the real card and tab content. */
function ReviewFixture({
  sessionId = 'session-test',
  projectRoot,
  syncComments,
  wordWrap,
  ...props
}: Omit<ProducedFilesProps, 'openReview'> & {
  sessionId?: string
  projectRoot?: string
  syncComments?: () => void
  wordWrap?: ObservableSnapshot<boolean>
}) {
  const [params, setParams] = useState<ReviewTarget>()
  const sessionSnapshot = useMemo(
    () => ({ byId: { [sessionId]: { cwd: projectRoot } } }),
    [sessionId, projectRoot],
  )
  const snapshot = useMemo(
    () => ({
      timeline: {
        turns: new Map([
          [
            props.turn?.turn ?? 0,
            turnLocation(
              props.turn?.turn ?? 0,
              produced(
                ...props.matched.map(
                  (review) => [props.seq ?? 0, review.path, review.diffs] as const,
                ),
              ),
            ),
          ],
        ]),
      },
    }),
    [props.matched, props.turn, props.seq],
  )
  return (
    <>
      <ProducedFiles {...props} openReview={setParams} />
      {params !== undefined && (
        <section role="tabpanel" aria-label={props.t('review.title')}>
          <button onClick={() => setParams(undefined)}>
            {props.t('review.title') === '审查' ? '关闭' : 'Close'}
          </button>
          <FileReviewTab
            sessions={
              {
                binding: () => ({}),
                list: { getSnapshot: () => sessionSnapshot, subscribe: () => () => {} },
              } as never
            }
            uiConversation={
              {
                binding: () => ({
                  target: () => ({ getSnapshot: () => snapshot, subscribe: () => () => {} }),
                }),
              } as never
            }
            sessionId={sessionId as SessionId}
            projectRoot={projectRoot}
            params={params}
            visible
            syncComments={syncComments}
            wordWrap={wordWrap ?? { getSnapshot: () => false, subscribe: () => () => {} }}
            openFile={props.openFile}
            t={props.t}
          />
        </section>
      )}
    </>
  )
}

const unifiedDiffCss = readFileSync('src/client/UnifiedDiff.module.css', 'utf8')

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  clearAllReviewComments()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

class TestTurnDataStore implements ConversationLocationDataStore<ConversationTurnDataMap> {
  private readonly values = new Map<string, unknown>()

  get<Key extends Extract<keyof ConversationTurnDataMap, string>>(
    key: Key,
  ): Readonly<ConversationTurnDataMap[Key]> | undefined {
    return this.values.get(key) as Readonly<ConversationTurnDataMap[Key]> | undefined
  }

  set<Key extends Extract<keyof ConversationTurnDataMap, string>>(
    key: Key,
    value: ConversationTurnDataMap[Key],
  ): void {
    this.values.set(key, value)
  }
}

const turnLocation = (turn: number, deliverables?: DeliverablesTurnData): TurnLocation => {
  const data = new TestTurnDataStore()
  if (deliverables !== undefined) data.set('deliverables', deliverables)
  return { turn, start: undefined, end: undefined, status: 'closed', steps: [], data }
}

const produced = (
  ...values: ReadonlyArray<
    readonly [seq: number, path: string, diffs?: readonly ProducedFileDiff[]]
  >
): DeliverablesTurnData => ({
  produced: values.map(([seq, path, diffs = []]) => ({ seq, path, diffs })),
})

const fileReview = (path: string, diffs: readonly ProducedFileDiff[] = []): ProducedFileReview => ({
  path,
  diffs,
})

const reviews = (paths: readonly string[]): readonly ProducedFileReview[] =>
  paths.map((path, index) =>
    fileReview(
      path,
      index === 0 ? [{ path, oldText: 'before', newText: 'after', oldStart: 7, newStart: 7 }] : [],
    ),
  )

function tailOwner(
  data: DeliverablesTurnData | undefined,
  seq: number,
  openFile: (path: string) => void = () => {},
  turn = 1,
): TurnTailOwnerProps {
  return { seq, openFile, turn: turnLocation(turn, data) }
}

interface ConversationEventInput {
  readonly event: ConversationMatch['event']
}

function at(seq: number, type: string, data: unknown): ConversationEventInput {
  return {
    event: {
      seq,
      time: seq * 1_000,
      type,
      data,
      ...(type === 'tool/result' ? { surfaceOp: 'append' } : {}),
    } as ConversationMatch['event'],
  }
}

function matched(
  input: ConversationEventInput,
  role: ConversationMatch['role'],
): ConversationMatch {
  return { ...input, role, location: { kind: 'unresolved' } } as ConversationMatch
}

function call(seq: number, callId: string, turn = 1, step = 1): ConversationEventInput {
  return at(seq, 'tool/call', { turn, step, callId, name: 'fixture', arguments: '{}' })
}

interface MarkerFile {
  readonly path: string
  readonly diffs?: readonly ProducedFileDiff[]
  readonly source?: 'result' | 'intent'
}

function result(
  seq: number,
  callId: string,
  files?: readonly MarkerFile[],
  options: {
    readonly isError?: boolean
    readonly turn?: number
    readonly step?: number
  } = {},
): ConversationEventInput {
  const turn = options.turn ?? 1
  const step = options.step ?? 1
  const marker =
    files === undefined
      ? null
      : boundedPtcFileReviewMarker({
          turn,
          step,
          rootCallId: callId,
          subCallId: callId,
          files: files.map((file) => ({
            path: file.path,
            diffs: file.diffs ?? [],
            source: file.source ?? 'result',
          })),
        })
  if (files !== undefined && marker === null) throw new Error('fixture marker exceeded its budget')
  return at(seq, 'tool/result', {
    turn,
    step,
    message: {
      source: { type: 'tool-result', callId },
      content: [
        {
          type: 'tool-result',
          content: marker === null ? [] : [markerBlock(marker)],
          isError: options.isError ?? false,
        },
      ],
    },
  })
}

function ptc(
  seq: number,
  subCallId: string,
  files: ReadonlyArray<{
    readonly path: string
    readonly diffs?: readonly ProducedFileDiff[]
    readonly source?: 'result' | 'intent'
  }>,
  options: {
    readonly rootCallId?: string
    readonly turn?: number
    readonly step?: number
    readonly isError?: boolean
  } = {},
): ConversationEventInput {
  const rootCallId = options.rootCallId ?? 'run-code'
  const marker = boundedPtcFileReviewMarker({
    turn: options.turn ?? 1,
    step: options.step ?? 1,
    rootCallId,
    subCallId,
    files: files.map((file) => ({
      path: file.path,
      diffs: file.diffs ?? [],
      source: file.source ?? 'result',
    })),
  })
  if (marker === null) throw new Error('fixture marker exceeded its budget')
  return at(seq, 'tool/ptc-dispatch', {
    rootCallId,
    parentCallId: rootCallId,
    subCallId,
    name: 'fixture',
    arguments: {},
    isError: options.isError ?? false,
    content: [markerBlock(marker)],
  })
}

/** Drive the package definition directly through the public definition callbacks. */
function fold(
  entries: readonly ConversationEventInput[],
): Readonly<DeliverablesTurnData> | undefined {
  const [first, ...updates] = entries
  if (first === undefined) return undefined
  const start = matched(first, 'start')
  const base = {
    key: 'deliverables:1',
    kind: 'deliverables',
    id: '1',
    matches: [start],
    start,
    state: undefined,
    current: new Map(),
  } as Parameters<typeof deliverablesDefinition.start>[0]
  const reader: Parameters<typeof deliverablesDefinition.start>[2] = { previous: () => undefined }
  let state = deliverablesDefinition.start(base, start, reader)
  for (const input of updates) {
    const candidate = deliverablesDefinition.match(input.event)
    if (candidate === null || candidate.role !== 'update') continue
    const match = matched(input, candidate.role)
    state = deliverablesDefinition.update({ ...base, state }, match, reader)
  }
  const location = deliverablesDefinition.buildLocationData({ ...base, state }, 'turn')
  return location?.kind === 'turn' ? (location.value as DeliverablesTurnData) : undefined
}

function makeTranslate(...dicts: readonly Record<string, string>[]) {
  return (key: string, params?: Record<string, unknown>): string => {
    const template = dicts.find((dict) => dict[key] !== undefined)?.[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    )
  }
}

describe('produced-file Turn data', () => {
  // 验证产出文件按首次出现顺序去重，只汇总结束回复之前的结果，无产出时不挂载卡片。
  it('deduplicates paths in first-seen order and stops at the closing Assistant seq', () => {
    const data = produced(
      [3, 'out/index.html'],
      [4, 'out/app.css'],
      [4, 'out/index.html'],
      [8, 'after.txt'],
    )
    expect(producedForClosing(data, 6)).toEqual(['out/index.html', 'out/app.css'])
    expect(reviewsForClosing(data, 6)).toEqual([
      fileReview('out/index.html'),
      fileReview('out/app.css'),
    ])
    expect(selectProducedFiles(tailOwner(data, 6))).toEqual([
      fileReview('out/index.html'),
      fileReview('out/app.css'),
    ])
    expect(producedForClosing(undefined)).toEqual([])
    expect(selectProducedFiles(tailOwner(undefined, 9, () => {}, 2))).toBeNull()
  })

  // 验证仅汇总成功且带审查标记的原生工具结果，忽略读取或失败结果，并标记不完整数据。
  it('folds successful native markers while ignoring markerless and failed results', () => {
    const value = fold([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'write'),
      result(3, 'write', [
        {
          path: 'out/index.html',
          diffs: [{ path: 'out/index.html', oldText: 'old html', newText: 'new html' }],
        },
        {
          path: 'out/app.css',
          diffs: [{ path: 'out/app.css', oldText: 'old css', newText: 'new css' }],
        },
      ]),
      call(4, 'edit'),
      result(5, 'edit', [{ path: 'notes.md', source: 'intent' }]),
      call(6, 'read'),
      result(7, 'read'),
      call(8, 'failed'),
      result(9, 'failed', [{ path: 'broken.txt' }], { isError: true }),
    ])

    expect(producedForClosing(value)).toEqual(['out/index.html', 'out/app.css', 'notes.md'])
    expect(reviewsForClosing(value)).toEqual([
      fileReview('out/index.html', [
        { path: 'out/index.html', oldText: 'old html', newText: 'new html' },
      ]),
      fileReview('out/app.css', [{ path: 'out/app.css', oldText: 'old css', newText: 'new css' }]),
      { ...fileReview('notes.md'), complete: false },
    ])
  })

  // 验证同一文件多次修改的差异块按顺序追加，无审查标记的结果不会产生额外差异。
  it('appends same-file marker hunks and ignores markerless results', () => {
    const value = fold([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'first'),
      result(3, 'first', [
        { path: 'same.txt', diffs: [{ path: 'same.txt', oldText: null, newText: 'x' }] },
      ]),
      call(4, 'second'),
      result(5, 'second', [
        {
          path: 'same.txt',
          diffs: [
            {
              path: 'same.txt',
              oldText: 'middle',
              newText: 'after',
              oldStart: 12,
              newStart: 12,
            },
          ],
        },
      ]),
      call(6, 'markerless'),
      result(7, 'markerless'),
    ])

    expect(reviewsForClosing(value)).toEqual([
      fileReview('same.txt', [
        { path: 'same.txt', oldText: null, newText: 'x' },
        { path: 'same.txt', oldText: 'middle', newText: 'after', oldStart: 12, newStart: 12 },
      ]),
    ])
  })

  // 验证部分捕获的标记只生成已记录文件的审查数据，不补充未捕获的文件。
  it('uses a partial marker without adding uncaptured files', () => {
    const value = fold([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'partial'),
      result(3, 'partial', [
        {
          path: 'applied.txt',
          diffs: [{ path: 'applied.txt', oldText: 'old', newText: 'actual' }],
        },
      ]),
    ])

    expect(reviewsForClosing(value)).toEqual([
      fileReview('applied.txt', [{ path: 'applied.txt', oldText: 'old', newText: 'actual' }]),
    ])
  })

  // 验证 PTC 的执行结果与调用意图合并到同一轮产出，并保留缺少完整差异的状态。
  it('folds PTC result and intent markers into the same Turn deliverables', () => {
    const value = fold([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'run-code'),
      ptc(3, 'run-code:code:0', [
        {
          path: 'out.txt',
          diffs: [
            { path: 'out.txt', oldText: 'before', newText: 'after', oldStart: 4, newStart: 4 },
          ],
        },
      ]),
      ptc(4, 'run-code:code:1', [
        {
          path: 'out.txt',
          source: 'intent',
          diffs: [{ path: 'out.txt', oldText: 'after', newText: 'planned' }],
        },
        { path: 'notes.md', source: 'intent' },
      ]),
      ptc(5, 'run-code:code:2', [
        {
          path: 'notes.md',
          diffs: [{ path: 'notes.md', oldText: 'before', newText: 'after' }],
        },
      ]),
    ])

    expect(reviewsForClosing(value)).toEqual([
      fileReview('out.txt', [
        { path: 'out.txt', oldText: 'before', newText: 'after', oldStart: 4, newStart: 4 },
        { path: 'out.txt', oldText: 'after', newText: 'planned' },
      ]),
      {
        ...fileReview('notes.md', [{ path: 'notes.md', oldText: 'before', newText: 'after' }]),
        complete: false,
      },
    ])
  })

  // 验证汇总原生创建标记时保留明确的生命周期和权限信息，不丢失创建语义。
  it('folds a native lifecycle marker instead of its ambiguous presentation diff', () => {
    const callId = 'native-create'
    const captured = boundedPtcFileReviewMarker({
      turn: 1,
      step: 1,
      rootCallId: callId,
      subCallId: callId,
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
    const value = fold([
      at(1, 'turn/start', { turn: 1 }),
      call(2, callId),
      result(3, callId, captured.files),
    ])

    expect(reviewsForClosing(value)).toEqual([fileReview('created.txt', captured.files[0]?.diffs)])
  })

  // 验证 PTC 重复结果只计入一次，失败、步骤不符、调用标识错配或缺失的结果被忽略。
  it('deduplicates PTC settlements and rejects failures or mismatched marker correlations', () => {
    const accepted = ptc(3, 'run-code:code:0', [{ path: 'one.txt' }])
    const duplicate = ptc(4, 'run-code:code:0', [{ path: 'duplicate.txt' }])
    const failed = ptc(5, 'run-code:code:1', [{ path: 'failed.txt' }], { isError: true })
    const mismatched = JSON.parse(
      JSON.stringify(ptc(6, 'run-code:code:2', [{ path: 'forged.txt' }])),
    ) as ConversationEventInput
    ;(mismatched.event.data as { rootCallId: string }).rootCallId = 'different-root'
    const wrongStep = ptc(7, 'run-code:code:3', [{ path: 'wrong-step.txt' }], { step: 2 })
    const missingRoot = ptc(8, 'missing:code:0', [{ path: 'missing-root.txt' }], {
      rootCallId: 'missing',
    })
    const invalidIds = JSON.parse(
      JSON.stringify(ptc(9, 'run-code:code:4', [{ path: 'invalid-id.txt' }])),
    ) as ConversationEventInput
    ;(invalidIds.event.data as { rootCallId: unknown }).rootCallId = null
    const value = fold([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'run-code'),
      accepted,
      duplicate,
      failed,
      mismatched,
      wrongStep,
      missingRoot,
      invalidIds,
    ])
    expect(producedForClosing(value)).toEqual(['one.txt'])
  })

  // 验证 PTC 会话事件经过 JSON 序列化和恢复后，仍能还原文件路径及差异预览。
  it('restores PTC previews after a JSON history round trip', () => {
    const entries = [
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'run-code'),
      ptc(3, 'run-code:code:0', [
        {
          path: 'persisted.txt',
          source: 'intent',
          diffs: [{ path: 'persisted.txt', oldText: 'old', newText: 'new' }],
        },
      ]),
    ]
    const restored = JSON.parse(JSON.stringify(entries)) as ConversationEventInput[]
    expect(reviewsForClosing(fold(restored))).toEqual([
      fileReview('persisted.txt', [{ path: 'persisted.txt', oldText: 'old', newText: 'new' }]),
    ])
  })

  // 验证没有标记、没有对应调用、步骤错配或替换历史内容的结果不会生成产出文件。
  it('ignores markerless, orphan, mismatched, and replacement results', () => {
    const replacement = result(8, 'replacement', [
      {
        path: 'replaced.txt',
        diffs: [{ path: 'replaced.txt', oldText: 'old', newText: 'new' }],
      },
    ])
    const value = fold([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'markerless'),
      result(3, 'markerless'),
      result(4, 'orphan', [
        {
          path: 'orphan.txt',
          diffs: [{ path: 'orphan.txt', oldText: 'old', newText: 'new' }],
        },
      ]),
      call(5, 'wrong-step'),
      result(6, 'wrong-step', [{ path: 'mismatched.txt' }], { step: 2 }),
      call(7, 'replacement'),
      {
        ...replacement,
        event: {
          ...replacement.event,
          surfaceOp: { op: 'replace', start: 1, end: 1 },
        } as ConversationEventInput['event'],
      },
    ])

    expect(producedForClosing(value)).toEqual([])
  })

  // 验证产出状态必须由 turn/start 初始化，无关更新事件不会改变已有状态。
  it('rejects an invalid start match and preserves state for an unrelated update', () => {
    const startMatch = matched(at(1, 'turn/start', { turn: 1 }), 'start')
    const emptyContext: Parameters<typeof deliverablesDefinition.start>[0] = {
      key: 'deliverables:1',
      kind: 'deliverables',
      id: '1',
      matches: [startMatch],
      start: startMatch,
      state: undefined,
      current: new Map(),
    }
    const reader: Parameters<typeof deliverablesDefinition.start>[2] = {
      previous: () => undefined,
    }
    const state = deliverablesDefinition.start(emptyContext, startMatch, reader)
    const unrelated = matched(
      at(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      'update',
    )
    const context: Parameters<typeof deliverablesDefinition.update>[0] = { ...emptyContext, state }

    expect(() => deliverablesDefinition.start(emptyContext, unrelated, reader)).toThrow(
      'deliverables start requires turn/start',
    )
    expect(deliverablesDefinition.update(context, unrelated)).toBe(state)
  })
})

describe('native review tab', () => {
  // 验证原生 Tab 通过 rc.1 的 chat 数据接口读取指定文件，隐藏后取消聊天数据订阅。
  it('reads the rc.1 chat target and unsubscribes while hidden', () => {
    const sessionBinding = {}
    const unsubscribeChat = vi.fn()
    const chatSnapshot = {
      timeline: {
        turns: new Map([[1, turnLocation(1, produced([3, 'src/a.ts'], [3, 'src/b.ts']))]]),
      },
    }
    const chat = {
      getSnapshot: () => chatSnapshot,
      subscribe: vi.fn(() => unsubscribeChat),
    }
    const target = vi.fn(() => chat)
    const bindConversation = vi.fn(() => ({ target }))
    const sessionsSnapshot = { byId: { 'session-1': { cwd: '/workspace' } } }
    const props = {
      sessions: {
        binding: vi.fn(() => sessionBinding),
        list: {
          getSnapshot: () => sessionsSnapshot,
          subscribe: () => () => {},
        },
      },
      uiConversation: { binding: bindConversation },
      sessionId: 'session-1',
      projectRoot: '/workspace',
      params: { turn: 1, closingSeq: 9, focusPaths: ['src/a.ts'] },
      visible: true,
      wordWrap: { getSnapshot: () => false, subscribe: () => () => {} },
      openFile: vi.fn(),
      t: makeTranslate(en),
    } as unknown as Parameters<typeof FileReviewTab>[0]

    const view = render(<FileReviewTab {...props} />)

    expect(view.getByText('src/a.ts')).toBeTruthy()
    expect(view.queryByText('src/b.ts')).toBeNull()
    expect(bindConversation).toHaveBeenCalledWith(sessionBinding)
    expect(target).toHaveBeenCalledWith('chat')
    expect(chat.subscribe).toHaveBeenCalledOnce()

    view.rerender(<FileReviewTab {...props} visible={false} />)
    expect(unsubscribeChat).toHaveBeenCalledOnce()
  })
})

describe('ProducedFiles review card', () => {
  const t = makeTranslate(en)
  const changedReviews: readonly ProducedFileReview[] = [
    fileReview('deep/a.html', [
      {
        path: 'deep/a.html',
        oldText: 'before\nkeep',
        newText: 'after\nkeep',
        oldStart: 7,
        newStart: 7,
      },
    ]),
    fileReview('styles/b.css', [
      {
        path: 'styles/b.css',
        oldText: null,
        newText: 'one\ntwo',
        oldStart: 1,
        newStart: 1,
      },
    ]),
  ]

  // 验证替换、新增、多差异块和空列表的新增行数与删除行数计算准确。
  it('derives exact totals for replacements, additions, multiple hunks, and empty reviews', () => {
    expect(summarizeDiffs(changedReviews[0]?.diffs ?? [])).toEqual({ added: 1, removed: 1 })
    expect(summarizeDiffs(changedReviews[1]?.diffs ?? [])).toEqual({ added: 2, removed: 0 })
    expect(summarizeDiffs([])).toEqual({ added: 0, removed: 0 })
    expect(
      summarizeDiffs([
        { path: 'a.md', oldText: 'x', newText: 'y', oldStart: 1, newStart: 1 },
        { path: 'a.md', oldText: 'same', newText: 'same\nnew', oldStart: 8, newStart: 8 },
      ]),
    ).toEqual({ added: 2, removed: 1 })
    expect(unifiedDiffText(changedReviews.flatMap((review) => review.diffs))).toContain(
      'styles/b.css\n+ one\n+ two',
    )
  })

  // 验证卡片同时展示总计和逐文件统计，默认仅显示六个文件，展开后显示剩余项。
  it('renders aggregate and per-file totals and expands the six-file preview', () => {
    const paths = ['deep/a.html', 'b.css', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts']
    const view = render(<ReviewFixture matched={reviews(paths)} openFile={() => {}} t={t} />)
    const card = view.getByRole('region', { name: 'Edited files' })
    expect(within(card).getByText('Edited 7 files')).toBeTruthy()
    const expand = within(card).getByRole('button', { name: '1 more file' })
    expect(within(card).getAllByRole('button')).toHaveLength(9)
    expect(within(card).queryByRole('button', { name: 'Review g.ts' })).toBeNull()

    fireEvent.click(expand)

    expect(within(card).getByRole('button', { name: 'Review g.ts' })).toBeTruthy()
    expect(within(card).queryByRole('button', { name: '1 more file' })).toBeNull()
    const first = within(card).getByRole('button', { name: 'Review deep/a.html' })
    expect(first.textContent).toContain('a.html')
    expect(first.getAttribute('title')).toBe('deep/a.html')
  })

  // 验证运行时切换语言后，文件卡片、行数统计、审查按钮和面板文案同步更新。
  it('renders the active Web UI language after the locale changes', () => {
    let active = en
    const translate = (key: string, params?: Record<string, unknown>): string =>
      makeTranslate(active)(key, params)
    const view = render(
      <ReviewFixture matched={changedReviews} openFile={() => {}} t={translate} />,
    )

    expect(view.getByRole('region', { name: 'Edited files' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Review all produced files' })).toBeTruthy()

    active = zh
    view.rerender(<ReviewFixture matched={changedReviews} openFile={() => {}} t={translate} />)

    const card = view.getByRole('region', { name: '已编辑文件' })
    expect(within(card).getByText('已编辑 2 个文件')).toBeTruthy()
    expect(within(card).getByLabelText('新增 3 行，删除 1 行')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: '审查所有产出文件' }))

    const panel = view.getByRole('tabpanel', { name: '审查' })
    expect(within(panel).getByText('2 个文件')).toBeTruthy()
    expect(within(panel).getByRole('button', { name: '复制差异' })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: '关闭' })).toBeTruthy()
    expect(within(panel).getAllByRole('button', { name: '在编辑器中打开' })).toHaveLength(2)
  })

  // 验证所有可逆文件撤销完成后按钮才切换为重新应用，操作成功时显示对应反馈。
  it('switches to reapply only after every reversible file is undone', async () => {
    const inspectChanges = vi.fn(async () => ({
      files: [{ path: 'deep/a.html', state: 'applied' as const, changed: false }],
    }))
    const applyChanges = vi
      .fn()
      .mockResolvedValueOnce({ files: [{ path: 'deep/a.html', state: 'undone', changed: true }] })
      .mockResolvedValueOnce({ files: [{ path: 'deep/a.html', state: 'applied', changed: true }] })
    const view = render(
      <ReviewFixture
        matched={[changedReviews[0]!]}
        openFile={() => {}}
        inspectChanges={inspectChanges}
        applyChanges={applyChanges}
        t={t}
      />,
    )

    await vi.waitFor(() => {
      expect((view.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false)
    })
    const timeout = vi.spyOn(window, 'setTimeout')
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await vi.waitFor(() => {
      expect(view.getByRole('button', { name: 'Reapply' })).toBeTruthy()
    })
    expect(view.getByRole('alert').textContent).toContain('Changes undone')
    expect(timeout.mock.calls.some(([, delay]) => delay === 2000)).toBe(true)
    expect(applyChanges.mock.calls[0]?.[0].action).toBe('undo')

    fireEvent.click(view.getByRole('button', { name: 'Reapply' }))
    await vi.waitFor(() => {
      expect(view.getByRole('button', { name: 'Undo' })).toBeTruthy()
    })
    expect(view.getByRole('alert').textContent).toContain('Changes reapplied')
    expect(applyChanges.mock.calls[1]?.[0].action).toBe('redo')
  })

  // 验证明确的创建和删除标记允许撤销，旧格式中语义不明的空快照不会启用撤销。
  it('enables Undo for explicit create/delete lifecycles but not legacy null snapshots', async () => {
    const lifecycleReviews = [
      fileReview('created.txt', [
        {
          path: 'created.txt',
          oldText: null,
          newText: 'created\n',
          oldStart: 1,
          newStart: 1,
          lifecycle: { kind: 'create', mode: 0o644 },
        },
      ]),
      fileReview('deleted.txt', [
        {
          path: 'deleted.txt',
          oldText: 'deleted\n',
          newText: '',
          oldStart: 1,
          newStart: 1,
          lifecycle: { kind: 'delete', mode: 0o600 },
        },
      ]),
    ]
    const inspectChanges = vi.fn(async () => ({
      files: lifecycleReviews.map((review) => ({
        path: review.path,
        state: 'applied' as const,
        changed: false,
      })),
    }))
    const applyChanges = vi.fn(async () => ({
      files: lifecycleReviews.map((review) => ({
        path: review.path,
        state: 'undone' as const,
        changed: true,
      })),
    }))
    const view = render(
      <ReviewFixture
        matched={[lifecycleReviews[0]!]}
        openFile={() => {}}
        inspectChanges={inspectChanges}
        applyChanges={applyChanges}
        t={t}
      />,
    )

    await vi.waitFor(() => {
      expect((view.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false)
    })

    view.rerender(
      <ReviewFixture
        matched={[lifecycleReviews[1]!]}
        openFile={() => {}}
        inspectChanges={inspectChanges}
        applyChanges={applyChanges}
        t={t}
      />,
    )
    await vi.waitFor(() => {
      expect((view.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false)
    })

    view.rerender(
      <ReviewFixture
        matched={[
          fileReview('legacy.txt', [
            {
              path: 'legacy.txt',
              oldText: null,
              newText: 'unknown provenance',
            },
          ]),
        ]}
        openFile={() => {}}
        t={t}
      />,
    )
    await vi.waitFor(() => {
      expect((view.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    })

    view.rerender(
      <ReviewFixture
        matched={[
          {
            path: 'truncated.txt',
            complete: false,
            diffs: [{ path: 'truncated.txt', oldText: 'before', newText: 'after' }],
          },
        ]}
        openFile={() => {}}
        t={t}
      />,
    )
    await vi.waitFor(() => {
      expect((view.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    })
  })

  // 验证部分文件冲突时保留撤销按钮并提示失败文件；没有可逆文件时禁用操作。
  it('keeps Undo in a mixed state and disables it when no file is reversible', async () => {
    const twoReversible = [
      fileReview('deep/a.txt', [{ path: 'deep/a.txt', oldText: 'a', newText: 'A' }]),
      fileReview('nested/b.txt', [{ path: 'nested/b.txt', oldText: 'b', newText: 'B' }]),
    ]
    const inspectChanges = vi.fn(async () => ({
      files: [
        { path: 'deep/a.txt', state: 'applied' as const, changed: false },
        { path: 'nested/b.txt', state: 'applied' as const, changed: false },
      ],
    }))
    const applyChanges = vi.fn(async () => ({
      files: [
        { path: 'deep/a.txt', state: 'undone' as const, changed: true },
        { path: 'nested/b.txt', state: 'conflict' as const, changed: false },
      ],
    }))
    const openFile = vi.fn<(path: string) => void>()
    const view = render(
      <ReviewFixture
        matched={twoReversible}
        openFile={openFile}
        inspectChanges={inspectChanges}
        applyChanges={applyChanges}
        t={t}
      />,
    )
    await vi.waitFor(() => {
      expect((view.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false)
    })
    const timeout = vi.spyOn(window, 'setTimeout')
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await vi.waitFor(() => {
      expect(view.getByRole('alert')).toBeTruthy()
    })
    expect(applyChanges).toHaveBeenCalledOnce()
    expect(view.getByRole('button', { name: 'Undo' })).toBeTruthy()
    const notice = view.getByRole('alert')
    expect(notice.textContent).toContain('Not all changes were restored')
    expect(notice.textContent).toContain('An error occurred while restoring some files')
    expect(notice.textContent).toContain('Skipped (1)')
    expect(notice.textContent).toContain('b.txt')
    expect(notice.textContent).not.toContain('nested/b.txt')
    expect(within(notice).queryByText('a.txt')).toBeNull()
    fireEvent.click(within(notice).getByRole('button', { name: 'Open b.txt' }))
    expect(openFile).toHaveBeenCalledExactlyOnceWith('nested/b.txt')
    const autoClose = timeout.mock.calls.find(([, delay]) => delay === 5000)?.[0]
    expect(autoClose).toBeTypeOf('function')
    act(() => {
      if (typeof autoClose === 'function') autoClose()
    })
    expect(view.queryByRole('alert')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await vi.waitFor(() => {
      expect(applyChanges).toHaveBeenCalledTimes(2)
    })

    view.rerender(<ReviewFixture matched={[fileReview('notes.md')]} openFile={() => {}} t={t} />)
    await vi.waitFor(() => {
      const button = view.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.title).toBe('No safely reversible files are available in this change')
    })
  })

  // 验证卡片总览打开全部文件的统一差异，复制内容包含各文件路径和差异，并显示成功反馈。
  it('reviews every file from the header and copies the visible unified diff', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const view = render(<ReviewFixture matched={changedReviews} openFile={() => {}} t={t} />)

    fireEvent.click(view.getByRole('button', { name: 'Review all produced files' }))
    const panel = view.getByRole('tabpanel', { name: 'Review' })
    const reviewHeader = panel.querySelector('[data-review-content] > header') as HTMLElement
    expect(within(panel).getByText('2 files')).toBeTruthy()
    expect(within(reviewHeader).queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(
      within(reviewHeader)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim()),
    ).toEqual(['Copy diff'])
    expect(within(panel).getByText('deep/a.html')).toBeTruthy()
    expect(within(panel).getByText('styles/b.css')).toBeTruthy()
    expect(panel.querySelectorAll('[data-diff-layout="unified"]')).toHaveLength(2)
    const firstDiff = panel.querySelectorAll('[data-diff-layout="unified"]')[0]
    expect(firstDiff?.getAttribute('data-word-wrap')).toBe('false')
    const firstDiffLines = firstDiff?.querySelectorAll('[data-line-kind]') ?? []
    expect([...firstDiffLines].map((line) => line.childElementCount)).toEqual([3, 3, 3])
    expect(
      [...firstDiffLines].map((line) => line.firstElementChild?.lastElementChild?.textContent),
    ).toEqual(['7', '7', '8'])

    fireEvent.click(within(panel).getByRole('button', { name: 'Copy diff' }))
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledOnce()
    })
    expect(writeText.mock.calls[0]?.[0]).toContain('deep/a.html')
    expect(writeText.mock.calls[0]?.[0]).toContain('styles/b.css')
    expect(within(panel).getByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  // 验证旧差异缺少行号时显示未知坐标，保留已知一侧行号，不生成虚假的评论位置。
  it('does not invent missing legacy coordinates and preserves a known side', () => {
    const review = fileReview('legacy.txt', [
      { path: 'legacy.txt', oldText: 'before', newText: 'after' },
      { path: 'legacy.txt', oldText: 'second before', newText: 'second after' },
      { path: 'legacy.txt', oldText: 'third before', newText: 'third after', newStart: 9 },
    ])
    const view = render(
      <ReviewFixture
        matched={[review]}
        openFile={() => {}}
        sessionId="legacy-session"
        turn={turnLocation(4)}
        seq={20}
        t={t}
      />,
    )

    fireEvent.click(view.getByRole('button', { name: 'Review legacy.txt' }))
    const panel = view.getByRole('tabpanel', { name: 'Review' })
    const lines = panel.querySelectorAll('[data-line-kind]')
    expect([...lines].map((line) => line.firstElementChild?.lastElementChild?.textContent)).toEqual(
      ['', '', '', '', '', '9'],
    )
    expect(
      [...lines]
        .slice(0, 5)
        .every(
          (line) => !line.hasAttribute('data-old-line') && !line.hasAttribute('data-new-line'),
        ),
    ).toBe(true)
    expect(lines[5]?.getAttribute('data-new-line')).toBe('9')
    expect(within(panel).getByText('@@ -? +? @@')).toBeTruthy()
    expect(within(panel).getByText('@@ -? +9 @@')).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Add comment on line 9' })).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Add comment on line 0' })).toBeNull()
    expect(unifiedDiffText(review.diffs)).toContain('@@ -? +? @@')
    expect(unifiedDiffText(review.diffs)).toContain('@@ -? +9 @@')
  })

  // 验证最多五行未修改内容直接展示，差异块之间更长的间隔显示折叠提示。
  it('shows up to five unchanged lines inline and collapses a larger hunk gap', () => {
    const inline = ['old-a', 'keep-1', 'keep-2', 'keep-3', 'keep-4', 'keep-5', 'old-b']
    const review = fileReview('threshold.txt', [
      {
        path: 'threshold.txt',
        oldText: inline.join('\n') + '\n',
        newText: ['new-a', ...inline.slice(1, -1), 'new-b'].join('\n') + '\n',
        oldStart: 1,
        newStart: 1,
      },
      {
        path: 'threshold.txt',
        oldText: 'old-c\n',
        newText: 'new-c\n',
        oldStart: 14,
        newStart: 14,
      },
    ])
    const view = render(<ReviewFixture matched={[review]} openFile={() => {}} t={t} />)

    fireEvent.click(view.getByRole('button', { name: 'Review threshold.txt' }))
    const panel = view.getByRole('tabpanel', { name: 'Review' })
    for (let line = 1; line <= 5; line++) {
      expect(within(panel).getByText(`keep-${line}`)).toBeTruthy()
    }
    expect(within(panel).queryByText('5 unchanged lines')).toBeNull()
    expect(within(panel).getByText('6 unchanged lines')).toBeTruthy()
  })

  // 验证自动换行只改变视觉布局，不改变长行原文或复制出的差异文本。
  it('visually wraps long lines without changing their logical text', () => {
    const longText = `const message = '${'long content '.repeat(24)}'`
    const review = fileReview('src/long-line.ts', [
      {
        path: 'src/long-line.ts',
        oldText: 'const message = short',
        newText: longText,
      },
    ])
    const wordWrap = { getSnapshot: () => true, subscribe: () => () => {} }
    const view = render(
      <ReviewFixture matched={[review]} openFile={() => {}} wordWrap={wordWrap} t={t} />,
    )

    fireEvent.click(view.getByRole('button', { name: 'Review src/long-line.ts' }))
    const panel = view.getByRole('tabpanel', { name: 'Review' })
    const diff = panel.querySelector('[data-diff-layout="unified"]')
    expect(diff?.getAttribute('data-word-wrap')).toBe('true')
    const added = diff?.querySelector('[data-line-kind="add"]')
    expect(added?.lastElementChild?.textContent).toBe(longText)
    expect(unifiedDiffText(review.diffs)).toContain(`+ ${longText}`)

    const wrapLineRule = /\.unifiedBodyWrap \.unifiedLine\s*\{([^}]*)\}/.exec(unifiedDiffCss)?.[1]
    expect(wrapLineRule).toContain('grid-template-columns: 48px 24px minmax(0, 1fr)')
    expect(wrapLineRule).toContain('min-width: 0')
    expect(wrapLineRule).toContain('white-space: pre-wrap')
    const wrapTextRule = /\.unifiedBodyWrap \.unifiedText\s*\{([^}]*)\}/.exec(unifiedDiffCss)?.[1]
    expect(wrapTextRule).toContain('overflow-wrap: anywhere')
  })

  // 验证新增行、删除行及展开的上下文行可添加评论，重新打开审查后评论仍在，并安全转义内容。
  it('comments added, deleted, and expanded context lines while retaining comments on reopen', () => {
    const commented = fileReview('src/example.ts', [
      {
        path: 'src/example.ts',
        oldText: 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine',
        newText: 'one\ntwo\nthree\nfour\nFIVE\nsix\nseven\neight\nnine',
        oldStart: 1,
        newStart: 1,
      },
    ])
    const ownerTurn = turnLocation(4)
    const view = render(
      <ReviewFixture
        matched={[commented]}
        openFile={() => {}}
        sessionId="session-comments"
        turn={ownerTurn}
        seq={20}
        t={t}
      />,
    )
    fireEvent.click(view.getByRole('button', { name: 'Review src/example.ts' }))
    const panel = view.getByRole('tabpanel', { name: 'Review' })

    const changedLineButtons = within(panel).getAllByRole('button', {
      name: 'Add comment on line 5',
    })
    fireEvent.click(changedLineButtons[0]!)
    let editor = within(panel).getByRole('textbox', { name: 'Edit comment on line 5' })
    expect(
      (within(panel).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.change(editor, { target: { value: 'Discard me.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(reviewComments('session-comments')).toHaveLength(0)

    fireEvent.click(within(panel).getAllByRole('button', { name: 'Add comment on line 5' })[0]!)
    editor = within(panel).getByRole('textbox', { name: 'Edit comment on line 5' })
    fireEvent.change(editor, { target: { value: 'Keep the previous behavior <safe>.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    const savedComment = within(panel).getByRole('button', {
      name: 'Keep the previous behavior <safe>.',
    })
    expect(savedComment.textContent).toBe('Keep the previous behavior <safe>.')
    const savedBodyRule = /\.commentBody\s*\{([^}]*)\}/.exec(unifiedDiffCss)?.[1]
    expect(savedBodyRule).toContain('display: flex')
    expect(savedBodyRule).toContain('align-items: flex-start')
    expect(savedBodyRule).toContain('justify-content: flex-start')
    expect(savedBodyRule).toContain('appearance: none')
    expect(savedBodyRule).toContain('min-height: 52px')
    expect(savedBodyRule).toContain('max-height: 176px')
    expect(savedBodyRule).toContain('flex: 0 0 auto')
    expect(savedBodyRule).toContain('overflow-y: auto')
    const commentRowRule = /\.commentRow\s*\{([^}]*)\}/.exec(unifiedDiffCss)?.[1]
    expect(commentRowRule).toContain('width: calc(100% - 68px)')
    expect(commentRowRule).toContain('max-width: 560px')
    const commentEditorRule = [
      ...unifiedDiffCss.matchAll(/(?:^|\n)\.commentEditor\s*\{([^}]*)\}/g),
    ].at(-1)?.[1]
    expect(commentEditorRule).toContain('max-height: 176px')
    expect(commentEditorRule).toContain('overflow-y: hidden')
    expect(reviewComments('session-comments')).toHaveLength(1)
    expect(serializeReviewComments('session-comments')).toContain('kind="del" old_line="5"')
    expect(serializeReviewComments('session-comments')).toContain('&lt;safe&gt;')

    fireEvent.click(
      within(panel).getByRole('button', { name: 'Keep the previous behavior <safe>.' }),
    )
    const existingEditor = within(panel).getByRole('textbox', { name: 'Edit comment on line 5' })
    fireEvent.change(existingEditor, { target: { value: 'Do not keep this edit.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(within(panel).getByText('Keep the previous behavior <safe>.')).toBeTruthy()
    expect(reviewComments('session-comments')[0]?.body).toBe('Keep the previous behavior <safe>.')

    fireEvent.click(within(panel).getAllByRole('button', { name: /unchanged lines/ })[0]!)
    fireEvent.click(within(panel).getByRole('button', { name: 'Add comment on line 1' }))
    const contextEditor = within(panel).getByRole('textbox', { name: 'Edit comment on line 1' })
    fireEvent.change(contextEditor, { target: { value: 'This context also matters.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    expect(reviewComments('session-comments')).toHaveLength(2)
    expect(serializeReviewComments('session-comments')).toContain(
      '<comment kind="context" old_line="1" new_line="1">',
    )

    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    fireEvent.click(view.getByRole('button', { name: 'Review src/example.ts' }))
    const reopened = view.getByRole('tabpanel', { name: 'Review' })
    expect(within(reopened).getByText('Keep the previous behavior <safe>.')).toBeTruthy()
    fireEvent.click(within(reopened).getAllByRole('button', { name: /unchanged lines/ })[0]!)
    expect(within(reopened).getByText('This context also matters.')).toBeTruthy()
    fireEvent.click(within(reopened).getAllByRole('button', { name: 'Delete' })[0]!)
    fireEvent.click(within(reopened).getByRole('button', { name: 'Delete' }))
    expect(reviewComments('session-comments')).toHaveLength(0)
  })

  // 验证评论输入框随内容增高至上限后滚动，输入法组合和 Shift+Enter 不保存，普通 Enter 保存。
  it('keeps comment height stable while auto-growing until the scroll limit', () => {
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
      return Math.max(52, this.value.split('\n').length * 22)
    })
    const review = fileReview('src/height.ts', [
      {
        path: 'src/height.ts',
        oldText: 'before',
        newText: 'after',
        oldStart: 1,
        newStart: 1,
      },
    ])
    const view = render(
      <ReviewFixture
        matched={[review]}
        openFile={() => {}}
        sessionId="comment-height"
        turn={turnLocation(2)}
        seq={9}
        t={t}
      />,
    )
    fireEvent.click(view.getByRole('button', { name: 'Review src/height.ts' }))
    const panel = view.getByRole('tabpanel', { name: 'Review' })
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Add comment on line 1' })[0]!)
    let editor = within(panel).getByRole('textbox', { name: 'Edit comment on line 1' })
    expect(within(panel).getByText('Shift+Enter for a new line')).toBeTruthy()
    expect(editor.style.height).toBe('52px')
    expect(editor.style.overflowY).toBe('hidden')

    fireEvent.change(editor, { target: { value: 'IME composition' } })
    expect(fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })).toBe(true)
    expect(reviewComments('comment-height')).toHaveLength(0)
    expect(within(panel).queryByRole('textbox', { name: 'Edit comment on line 1' })).not.toBeNull()
    expect(fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(reviewComments('comment-height')).toHaveLength(0)

    const growingComment = ['one', 'two', 'three'].join('\n')
    fireEvent.change(editor, { target: { value: growingComment } })
    expect(editor.style.height).toBe('66px')
    expect(editor.style.overflowY).toBe('hidden')

    const longComment = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n')
    fireEvent.change(editor, { target: { value: longComment } })
    expect(editor.style.height).toBe('176px')
    expect(editor.style.overflowY).toBe('auto')
    expect(fireEvent.keyDown(editor, { key: 'Enter' })).toBe(false)
    expect(reviewComments('comment-height')[0]?.body).toBe(longComment)

    fireEvent.click(within(panel).getByRole('button', { name: longComment }))
    editor = within(panel).getByRole('textbox', { name: 'Edit comment on line 1' })
    expect(editor.style.height).toBe('176px')
    expect(editor.style.overflowY).toBe('auto')
  })

  // 验证点击文件行只审查该文件，可在编辑器中打开，关闭后移除审查面板。
  it('focuses one file from its row, opens it in the editor, and closes the tab', () => {
    const openFile = vi.fn<(path: string) => void>()
    const view = render(<ReviewFixture matched={changedReviews} openFile={openFile} t={t} />)
    const trigger = view.getByRole('button', { name: 'Review deep/a.html' })

    fireEvent.click(trigger)
    const panel = view.getByRole('tabpanel', { name: 'Review' })
    expect(within(panel).getByText('1 file')).toBeTruthy()
    expect(within(panel).queryByText('styles/b.css')).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'Open in editor' }))
    expect(openFile).toHaveBeenCalledExactlyOnceWith('deep/a.html')
    fireEvent.click(view.getByRole('button', { name: 'Close' }))
    expect(view.queryByRole('tabpanel')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.click(view.getByRole('button', { name: 'Close' }))
    expect(view.queryByRole('tabpanel')).toBeNull()
  })

  // 验证界面显示相对会话工作区的路径，但打开编辑器时仍传递完整绝对路径。
  it('shows review paths relative to the Session project while opening the absolute path', () => {
    const absolutePath = '/Users/test/projects/example/docs/guide.md'
    const absoluteReview = fileReview(absolutePath, [
      {
        path: absolutePath,
        oldText: 'before',
        newText: 'after',
        oldStart: 1,
        newStart: 1,
      },
    ])
    const openFile = vi.fn<(path: string) => void>()
    const view = render(
      <ReviewFixture
        matched={[absoluteReview]}
        openFile={openFile}
        projectRoot="/Users/test/projects/example"
        t={t}
      />,
    )

    fireEvent.click(view.getByRole('button', { name: `Review ${absolutePath}` }))
    const panel = view.getByRole('tabpanel', { name: 'Review' })
    expect(within(panel).getByText('docs/guide.md')).toBeTruthy()
    expect(within(panel).queryByText(absolutePath)).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'Open in editor' }))
    expect(openFile).toHaveBeenCalledExactlyOnceWith(absolutePath)
  })

  // 验证差异不可用时显示原因并禁用复制，同时保留在编辑器中打开文件的能力。
  it('explains unavailable diffs and disables copying while keeping editor access', () => {
    const openFile = vi.fn<(path: string) => void>()
    const view = render(
      <ReviewFixture matched={[fileReview('notes.md')]} openFile={openFile} t={t} />,
    )
    fireEvent.click(view.getByRole('button', { name: 'Review notes.md' }))
    const panel = view.getByRole('tabpanel', { name: 'Review' })
    expect(
      within(panel).getByText(
        'No reconstructable diff is available for this change. You can still open the current file.',
      ),
    ).toBeTruthy()
    expect(
      (within(panel).getByRole('button', { name: 'Copy diff' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.click(within(panel).getByRole('button', { name: 'Open in editor' }))
    expect(openFile).toHaveBeenCalledExactlyOnceWith('notes.md')
  })
})

describe('review comment composer chip', () => {
  const t = makeTranslate(en)

  // 验证悬停评论汇总入口可预览相对路径、行号和正文，清除入口会删除本会话评论。
  it('previews comments on hover with project-relative paths and can remove the aggregate', () => {
    const absolutePath = '/Users/test/projects/example/src/client/index.ts'
    setReviewComment({
      sessionId: 'dock-session',
      turn: 3,
      closingSeq: 12,
      body: 'Please keep this behavior.',
      anchor: {
        path: absolutePath,
        hunkIndex: 0,
        rowIndex: 2,
        kind: 'add',
        oldLine: null,
        newLine: 19,
        text: 'const value = true',
        excerpt: '+ const value = true',
      },
    })
    const props = {
      sessionId: 'dock-session',
      projectRoot: '/Users/test/projects/example',
      t,
    } as unknown as ReviewCommentsDockProps
    const view = render(<ReviewCommentsDock {...props} />)

    const pill = view.getByRole('button', { name: 'Preview 1 review comments' })
    expect(view.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(pill)
    const preview = view.getByRole('tooltip', { name: 'Review comment preview' })
    expect(within(preview).getByText('src/client/index.ts')).toBeTruthy()
    expect(within(preview).queryByText(absolutePath)).toBeNull()
    expect(within(preview).getByText('right line 19')).toBeTruthy()
    expect(within(preview).getByText('Please keep this behavior.')).toBeTruthy()
    fireEvent.mouseLeave(pill)
    expect(view.queryByRole('tooltip')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'Remove all review comments' }))
    expect(view.queryByRole('tooltip')).toBeNull()
    expect(reviewComments('dock-session')).toHaveLength(0)
  })
})

describe('sent review comment projection', () => {
  // 验证仅识别消息开头的审查评论封装，并保留后续用户文字，不误识别正文中的同类片段。
  it('recognizes the leading review envelope and preserves following user text', () => {
    setReviewComment({
      sessionId: 'sent-session',
      turn: 3,
      closingSeq: 12,
      body: 'Keep this behavior.',
      anchor: {
        path: 'src/client/index.ts',
        hunkIndex: 0,
        rowIndex: 2,
        kind: 'add',
        oldLine: null,
        newLine: 19,
        text: 'const value = true',
        excerpt: '+ const value = true',
      },
    })
    const serialized = serializeReviewComments('sent-session')

    expect(projectReviewMessageText(`${serialized}\n\nPlease apply it.`)).toEqual({
      commentCount: 1,
      comments: [
        {
          path: 'src/client/index.ts',
          kind: 'add',
          oldLine: '',
          newLine: '19',
          body: 'Keep this behavior.',
        },
      ],
      visibleText: 'Please apply it.',
    })
    expect(projectReviewMessageText(`Prefix\n${serialized}`)).toBeNull()
  })

  // 验证模型专用评论封装显示为数量标签，隐藏原始标记，同时保留用户文字、图片及悬停预览。
  it('renders the model-only envelope as a compact comment count pill', () => {
    const absolutePath = '/Users/test/projects/example/src/client/index.ts'
    const attachment = { id: 'image-1' }
    const renderMessageImages = vi.fn(() => <span>Rendered image</span>)
    setReviewComment({
      sessionId: 'rendered-session',
      turn: 3,
      closingSeq: 12,
      body: 'Keep this behavior.',
      anchor: {
        path: absolutePath,
        hunkIndex: 0,
        rowIndex: 2,
        kind: 'add',
        oldLine: null,
        newLine: 19,
        text: 'const value = true',
        excerpt: '+ const value = true',
      },
    })
    const serialized = serializeReviewComments('rendered-session')
    const props = {
      node: {
        data: {
          content: [
            { type: 'text', text: `${serialized}\n\nPlease apply it.` },
            { type: 'image', attachment },
          ],
          time: Date.now(),
        },
      },
      renderMessageImages,
      cwd: '/Users/test/projects/example',
      t: (key: string) => key,
      reviewT: makeTranslate(en),
    } as unknown as Parameters<typeof ReviewUserMessage>[0]
    const view = render(<ReviewUserMessage {...props} />)

    expect(view.getByText('1 comment')).toBeTruthy()
    expect(view.getByText('Please apply it.')).toBeTruthy()
    expect(view.getByText('Rendered image')).toBeTruthy()
    expect(renderMessageImages).toHaveBeenCalledExactlyOnceWith({
      images: [{ attachment }],
      align: 'end',
    })
    expect(view.queryByText(/file_review_comments/)).toBeNull()

    const pill = view.getByRole('button', { name: '1 comment' })
    expect(view.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(pill)
    const preview = view.getByRole('tooltip')
    const hoverBridge = preview.parentElement
    expect(hoverBridge?.hasAttribute('data-review-comment-hover-bridge')).toBe(true)
    expect(within(preview).getByText('src/client/index.ts')).toBeTruthy()
    expect(within(preview).queryByText(absolutePath)).toBeNull()
    expect(within(preview).getByText('right line 19')).toBeTruthy()
    expect(within(preview).getByText('Keep this behavior.')).toBeTruthy()
    fireEvent.mouseLeave(pill, { relatedTarget: hoverBridge })
    fireEvent.mouseEnter(hoverBridge!, { relatedTarget: pill })
    expect(view.queryByRole('tooltip')).not.toBeNull()
    fireEvent.mouseLeave(hoverBridge!, { relatedTarget: document.body })
    expect(view.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(pill)
    fireEvent.mouseLeave(pill)
    expect(view.queryByRole('tooltip')).toBeNull()
  })
})

describe('producedFileMentions resolver', () => {
  const label = (path: string) => `Open ${path}`

  // 验证精确路径和唯一文件名能解析为可点击引用，重名或未知文件保持未解析状态。
  it('resolves exact paths and unique basenames; ambiguity and unknowns stay unresolved', () => {
    const opened: string[] = []
    const resolver = producedFileMentions(
      ['out/index.html', 'a/style.css', 'b/style.css'],
      (path) => {
        opened.push(path)
      },
      label,
    )
    // Unique basename resolves to its full path; the full path rides title.
    const byBasename = resolver.resolve('index.html')
    expect(byBasename?.label).toBe('Open out/index.html')
    expect(byBasename?.title).toBe('out/index.html')
    byBasename?.open()
    expect(opened).toEqual(['out/index.html'])
    // An exact path resolves even when its basename is ambiguous.
    const exact = resolver.resolve('a/style.css')
    expect(exact?.title).toBe('a/style.css')
    // A basename two paths share stays unresolved rather than guessing,
    // and so does a token naming nothing the turn wrote.
    expect(resolver.resolve('style.css')).toBeUndefined()
    expect(resolver.resolve('notes.md')).toBeUndefined()
    expect(basename('a\\b\\c.txt')).toBe('c.txt')
  })
})

describe('FileReview settings card', () => {
  // 验证展开插件设置后显示换行开关，切换时保存新值，并提供安全的新窗口项目链接。
  it('discloses the word-wrap switch and saves its next value', async () => {
    const snapshot = {
      status: 'ready' as const,
      value: { wordWrap: false },
      base: { wordWrap: false },
      user: {},
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }
    const setWordWrap = vi.fn(async () => {})
    const props = {
      t: makeTranslate(en),
      useFileReviewSettings: <Selected,>(select: (value: typeof snapshot) => Selected) =>
        select(snapshot),
      setWordWrap,
    } as unknown as FileReviewSettingsCardProps
    const view = render(<FileReviewSettingsCard {...props} />)

    const starLink = view.getByRole('link', { name: en['settings.star.aria'] })
    expect(starLink.getAttribute('href')).toBe('https://github.com/left0ver/dsh-file-review')
    expect(starLink.getAttribute('target')).toBe('_blank')
    expect(starLink.getAttribute('rel')).toBe('noopener noreferrer')
    expect(view.queryByRole('switch')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Expand: File review' }))
    const toggle = view.getByRole('switch', { name: 'Automatically wrap long lines' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await vi.waitFor(() => {
      expect(setWordWrap).toHaveBeenCalledExactlyOnceWith(true)
    })
  })
})

describe('plugin registration', () => {
  // 验证客户端入口注册远程服务、轮次数据、文件卡片、评论入口、语言和文件引用，并在卸载时释放资源。
  it('registers the Remote, turn definition, tail entry, dictionaries, and mention service', async () => {
    let definition: unknown
    let slot:
      | {
          options: {
            id?: string
            inject?: (sessionId: string) => unknown
            locale?: string
            name?: string
          }
          component: unknown
        }
      | undefined
    const registrations: Array<{
      options: {
        id?: string
        inject?: (sessionId: string) => unknown
        key?: string
        locale?: string
        name?: string
        order?: number
        priority?: number
      }
      component: unknown
    }> = []
    let service: ChatFileMentions | undefined
    const registerLocale = vi.fn(() => () => {})
    const disposeRemote = vi.fn(async () => {})
    const mountRemote = vi.fn(async () => disposeRemote)
    class RemoteFixture extends Service {
      constructor(scoped: Context) {
        super(scoped, 'remote')
      }
    }
    class FileReviewRemoteFixture extends Service {
      constructor(scoped: Context) {
        super(scoped, 'remote.fileReview')
      }
      async status(): Promise<{ ok: true; value: { files: readonly [] } }> {
        return { ok: true, value: { files: [] } }
      }
      async apply(): Promise<{ ok: true; value: { files: readonly [] } }> {
        return { ok: true, value: { files: [] } }
      }
    }
    const cordis = new Context()
    const remoteFixture = cordis.plugin({
      apply: (scoped) => {
        new RemoteFixture(scoped)
      },
    })
    const fileReviewFixture = cordis.plugin({
      apply: (scoped) => {
        new FileReviewRemoteFixture(scoped)
      },
    })
    await Promise.all([remoteFixture, fileReviewFixture])
    // Match SessionRuntime: its Agent-scope fiber knows the root Remote service,
    // but not feature namespaces mounted after the runtime started.
    const sessionScope = cordis.plugin({ inject: ['remote'], apply: () => {} })
    await sessionScope
    const inputSnapshot = {
      draft: '',
      draftRev: 0,
      phase: 'plain' as const,
      occurrences: [],
    }
    const disposeSource = vi.fn()
    const registerSource = vi.fn(() => disposeSource)
    let settingsValue = { wordWrap: false }
    const settingsListeners = new Set<() => void>()
    const publishWordWrap = (value: boolean): void => {
      settingsValue = { wordWrap: value }
      for (const listener of settingsListeners) listener()
    }
    const settingsScope = {
      getSnapshot: () => ({
        status: 'ready' as const,
        value: settingsValue,
        base: { wordWrap: false },
        user: {},
        revision: 1,
        writable: true,
        mode: 'host' as const,
      }),
      subscribe: (listener: () => void) => {
        settingsListeners.add(listener)
        return () => {
          settingsListeners.delete(listener)
        }
      },
      set: vi.fn(async (_field: string, value: unknown) => {
        publishWordWrap(value === true)
      }),
      unset: vi.fn(async () => {
        publishWordWrap(false)
      }),
    }
    const bindSettings = vi.fn(() => settingsScope)
    const ctx = {
      remote: { $mount: mountRemote },
      settingsScope: { bind: bindSettings },
      sessions: {
        scope: vi.fn(() => sessionScope.ctx),
        binding: vi.fn(() => ({
          ctx: sessionScope.ctx,
          eventSource: {
            getSnapshot: () => ({ change: { kind: 'replace', entries: [] } }),
            subscribe: () => () => {},
          },
        })),
        list: {
          getSnapshot: () => ({
            byId: {
              'session-1': { cwd: '/workspace/project' },
            },
          }),
        },
      },
      uiConversation: {
        events: {
          register: (value: unknown) => {
            definition = value
            return () => {}
          },
        },
      },
      conversation: {
        input: {
          for: () => ({
            state: { getSnapshot: () => inputSnapshot, subscribe: () => () => {} },
            setDraft: vi.fn(),
          }),
        },
      },
      inputTriggers: { registerSource },
      sidebarRight: { openTabIn: vi.fn() },
      sidebarRightTabs: { register: vi.fn(() => () => {}) },
      effect: (setup: () => void) => {
        setup()
      },
      locale: { register: registerLocale, bind: () => makeTranslate(en) },
      slots: {
        inject: (_name: string, setup: () => void) => {
          setup()
        },
        register: (
          options: {
            id?: string
            inject?: (sessionId: string) => unknown
            key?: string
            locale?: string
            name?: string
            priority?: number
          },
          component: unknown,
        ) => {
          const registration = { options, component }
          registrations.push(registration)
          if (options.name === 'conversation.chat.turnTail') slot = registration
          return () => {}
        },
      },
      provide: (name: string, value: ChatFileMentions) => {
        if (name === 'chatFileMentions') service = value
      },
    }

    const dispose = await apply(ctx as never)
    expect(inject).toEqual([
      'slots',
      'locale',
      'uiConversation',
      'remote',
      'connection',
      'settingsScope',
      'sessions',
      'conversation',
      'inputTriggers',
      'sidebarRight',
      'sidebarRightTabs',
    ])
    expect(bindSettings).toHaveBeenCalledWith({ namespace: 'file-review' })
    publishWordWrap(true)
    expect(registerSource).toHaveBeenCalledOnce()
    expect(mountRemote).toHaveBeenCalledOnce()
    expect(definition).toBe(deliverablesDefinition)
    expect(registerLocale).toHaveBeenCalledWith('file-review', { zh, en })
    const settingsRegistration = registrations.find(
      (registration) => registration.options.name === 'settings.plugin.item',
    )
    expect(settingsRegistration).toEqual({
      options: expect.objectContaining({
        name: 'settings.plugin.item',
        key: 'file-review',
        priority: -100,
        locale: NS,
        inject: expect.any(Function),
      }),
      component: FileReviewSettingsCard,
    })
    expect(registrations).toContainEqual({
      options: expect.objectContaining({
        name: 'conversation.input.dock',
        id: 'file-review-comments',
        locale: NS,
        inject: expect.any(Function),
      }),
      component: ReviewCommentsDock,
    })
    const dockRegistration = registrations.find(
      (registration) => registration.options.name === 'conversation.input.dock',
    )
    expect(dockRegistration?.options.inject?.('session-1')).toEqual({
      projectRoot: '/workspace/project',
    })
    expect(registrations).toEqual(
      expect.arrayContaining([
        {
          options: expect.objectContaining({
            name: 'conversation.chat.node',
            key: 'user',
            priority: -10,
            locale: 'chat',
          }),
          component: ReviewUserMessage,
        },
        {
          options: expect.objectContaining({
            name: 'conversation.chat.node',
            key: 'steering',
            priority: -10,
            locale: 'chat',
          }),
          component: ReviewUserMessage,
        },
      ]),
    )
    expect(slot?.component).toBe(ProducedFiles)
    expect(slot?.options.locale).toBe(NS)
    expect(slot?.options.inject).toBeTypeOf('function')
    const reviewActions = slot?.options.inject?.('session-1') as {
      openReview(target: ReviewTarget): void
      inspectChanges(request: {
        action: 'undo'
        files: readonly []
      }): Promise<{ files: readonly [] }>
      applyChanges(request: { action: 'undo'; files: readonly [] }): Promise<{ files: readonly [] }>
    }
    expect(reviewActions.openReview).toBeTypeOf('function')
    const target = { turn: 1, closingSeq: 2, focusPaths: ['a.txt'] }
    reviewActions.openReview(target)
    expect(ctx.sidebarRight.openTabIn).toHaveBeenCalledWith('session-1', 'dsh-file-review:review', {
      params: target,
    })
    await expect(reviewActions.inspectChanges({ action: 'undo', files: [] })).resolves.toEqual({
      files: [],
    })
    await expect(reviewActions.applyChanges({ action: 'undo', files: [] })).resolves.toEqual({
      files: [],
    })
    const settingsActions = settingsRegistration?.options.inject?.('') as {
      hooks: { fileReviewSettings: typeof settingsScope }
      setWordWrap(value: boolean): Promise<void>
    }
    expect(settingsActions.hooks.fileReviewSettings).toBe(settingsScope)
    await settingsActions.setWordWrap(false)
    expect(settingsScope.set).toHaveBeenCalledExactlyOnceWith('wordWrap', false)

    const opened: string[] = []
    const owner = tailOwner(produced([2, 'site/report.html']), 3, (path) => {
      opened.push(path)
    })
    const mentions = service?.forClosing(owner)
    mentions?.resolve('report.html')?.open()
    expect(opened).toEqual(['site/report.html'])
    expect(service?.forClosing(tailOwner(undefined, 2))).toBeUndefined()
    await dispose()
    expect(disposeRemote).toHaveBeenCalledOnce()
    expect(disposeSource).toHaveBeenCalledOnce()
    await sessionScope.dispose()
    await fileReviewFixture.dispose()
    await remoteFixture.dispose()
  })
})
