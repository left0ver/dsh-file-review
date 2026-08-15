// @vitest-environment jsdom
/**
 * dsh-file-review browser half: the derivation contract of
 * `producedForClosing` over engine-published Turn data, the row's rendering
 * and opener wiring, plus the plugin's public service registrations.
 */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ConversationEventInput, ConversationLocationDataStore, ConversationMatch,
  ConversationTurnDataMap, ToolResultNode, TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatFileMentions, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ProducedFiles } from '../src/client/ProducedFiles.tsx'
import { summarizeDiffs, unifiedDiffText } from '../src/client/UnifiedDiff.tsx'
import {
  basename, deliverablesDefinition, producedFileMentions, producedForClosing, reviewsForClosing,
  selectProducedFiles, type DeliverablesTurnData, type ProducedFileDiff, type ProducedFileReview,
} from '../src/client/turn-deliverables.ts'
import { apply, inject } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
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
  ...values: ReadonlyArray<readonly [seq: number, path: string, diffs?: readonly ProducedFileDiff[]]>
): DeliverablesTurnData => ({
  produced: values.map(([seq, path, diffs = []]) => ({ seq, path, diffs })),
})

const fileReview = (
  path: string,
  diffs: readonly ProducedFileDiff[] = [],
): ProducedFileReview => ({ path, diffs })

const reviews = (paths: readonly string[]): readonly ProducedFileReview[] => paths.map((path, index) =>
  fileReview(path, index === 0
    ? [{ path, oldText: 'before', newText: 'after', oldStart: 7, newStart: 7 }]
    : []))

function tailOwner(
  data: DeliverablesTurnData | undefined,
  seq: number,
  openFile: (path: string) => void = () => {},
  turn = 1,
): TurnTailOwnerProps {
  return { seq, openFile, turn: turnLocation(turn, data) }
}

function at(
  seq: number,
  type: string,
  data: unknown,
  view?: ConversationEventInput['view'],
): ConversationEventInput {
  return {
    event: {
      seq, time: seq * 1_000, type, data,
      ...(type === 'tool/result' ? { surfaceOp: 'append' } : {}),
    } as ConversationEventInput['event'],
    view,
  }
}

function matched(input: ConversationEventInput, role: ConversationMatch['role']): ConversationMatch {
  return { ...input, role, location: { kind: 'unresolved' } }
}

function call(
  seq: number,
  callId: string,
  view: ToolResultNode['callView'],
  turn = 1,
): ConversationEventInput {
  return at(
    seq,
    'tool/call',
    { turn, step: 1, callId, name: 'fixture', arguments: '{}' },
    { for: 'call', view: view ?? { card: 'generic', title: 'fixture' } },
  )
}

function result(
  seq: number,
  callId: string,
  isError = false,
  turn = 1,
  view?: NonNullable<ToolResultNode['resultView']>,
): ConversationEventInput {
  return at(seq, 'tool/result', {
    turn,
    step: 1,
    message: {
      source: { type: 'tool-result', callId },
      content: [{ type: 'tool-result', content: [], isError }],
    },
  }, view === undefined ? undefined : { for: 'result', view })
}

function diff(...paths: string[]): ToolResultNode['callView'] {
  return {
    card: 'diff', title: `Write ${paths[0] ?? ''}`,
    diffs: paths.map(path => ({ path, oldText: null, newText: 'x' })),
    locations: paths.map(path => ({ path })),
  }
}

function edit(path: string): ToolResultNode['callView'] {
  return { card: 'generic', title: `insert ${path}`, kind: 'edit', locations: [{ path }] }
}

function appliedDiff(
  ...diffs: ReadonlyArray<readonly [
    path: string, oldText: string | null, newText: string, oldStart?: number, newStart?: number,
  ]>
): NonNullable<ToolResultNode['resultView']> {
  return {
    card: 'diff',
    diffs: diffs.map(([path, oldText, newText, oldStart, newStart]) => ({
      path,
      oldText,
      newText,
      ...(oldStart === undefined ? {} : { oldStart }),
      ...(newStart === undefined ? {} : { newStart }),
    })),
  }
}

/** Drive the package definition directly through the public definition callbacks. */
function fold(entries: readonly ConversationEventInput[]): Readonly<DeliverablesTurnData> | undefined {
  const [first, ...updates] = entries
  if (first === undefined) return undefined
  const start = matched(first, 'start')
  const base = {
    key: 'deliverables:1', kind: 'deliverables', id: '1', matches: [start],
    start, state: undefined, current: new Map(),
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
  return location?.kind === 'turn' ? location.value as DeliverablesTurnData : undefined
}

function makeTranslate(...dicts: readonly Record<string, string>[]) {
  return (key: string, params?: Record<string, unknown>): string => {
    const template = dicts.find(dict => dict[key] !== undefined)?.[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}

describe('produced-file Turn data', () => {
  it('deduplicates paths in first-seen order and stops at the closing Assistant seq', () => {
    const data = produced(
      [3, 'out/index.html'],
      [4, 'out/app.css'],
      [4, 'out/index.html'],
      [8, 'after.txt'],
    )
    expect(producedForClosing(data, 6)).toEqual(['out/index.html', 'out/app.css'])
    expect(reviewsForClosing(data, 6)).toEqual([
      fileReview('out/index.html'), fileReview('out/app.css'),
    ])
    expect(selectProducedFiles(tailOwner(data, 6))).toEqual([
      fileReview('out/index.html'), fileReview('out/app.css'),
    ])
    expect(producedForClosing(undefined)).toEqual([])
    expect(selectProducedFiles(tailOwner(undefined, 9, () => {}, 2))).toBeNull()
  })

  it('folds successful diff and generic-edit calls while ignoring reads, failures, and missing locations', () => {
    const value = fold([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'write', diff('out/index.html', 'out/app.css')),
      result(3, 'write', false, 1, appliedDiff(
        ['out/index.html', 'old html', 'new html'],
        ['out/app.css', 'old css', 'new css'],
      )),
      call(4, 'edit', edit('notes.md')),
      result(5, 'edit'),
      call(6, 'read', { card: 'generic', title: 'Read', locations: [{ path: 'input.txt' }] }),
      result(7, 'read'),
      call(8, 'failed', diff('broken.txt')),
      result(9, 'failed', true),
      call(10, 'locationless', { card: 'diff', title: 'Write', diffs: [] }),
      result(11, 'locationless'),
    ])

    expect(producedForClosing(value)).toEqual([
      'out/index.html', 'out/app.css', 'notes.md',
    ])
    expect(reviewsForClosing(value)).toEqual([
      fileReview('out/index.html', [{ path: 'out/index.html', oldText: 'old html', newText: 'new html' }]),
      fileReview('out/app.css', [{ path: 'out/app.css', oldText: 'old css', newText: 'new css' }]),
      fileReview('notes.md'),
    ])
  })

  it('appends same-file hunks in settlement order and uses call intent only without a result view', () => {
    const value = fold([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'first', diff('same.txt')),
      result(3, 'first'),
      call(4, 'second', diff('same.txt')),
      result(5, 'second', false, 1, appliedDiff(['same.txt', 'middle', 'after', 12, 12])),
      call(6, 'malformed', diff('broken.txt')),
      result(7, 'malformed', false, 1, {
        card: 'diff', diffs: [{ path: 'broken.txt', oldText: 'a', newText: 'b', oldStart: 0 }],
      } as never),
    ])

    expect(reviewsForClosing(value)).toEqual([
      fileReview('same.txt', [
        { path: 'same.txt', oldText: null, newText: 'x' },
        { path: 'same.txt', oldText: 'middle', newText: 'after', oldStart: 12, newStart: 12 },
      ]),
      fileReview('broken.txt'),
    ])
  })

  it('ignores calls without mutation locations, orphan results, and replacement results', () => {
    const replacement = result(8, 'replacement')
    const value = fold([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'tool/call', { turn: 1, step: 1, callId: 'no-view', name: 'fixture', arguments: '{}' }),
      result(3, 'no-view'),
      call(4, 'locationless-edit', { card: 'generic', title: 'Edit', kind: 'edit' }),
      result(5, 'locationless-edit'),
      result(6, 'orphan'),
      call(7, 'replacement', diff('replaced.txt')),
      {
        ...replacement,
        event: {
          ...replacement.event,
          surfaceOp: { op: 'replace', start: 1, end: 1 },
        } as ConversationEventInput['event'],
      },
      call(9, 'malformed-locations', {
        card: 'diff', title: 'Write', diffs: [], locations: [null, { path: 4 }],
      } as never),
      result(10, 'malformed-locations'),
      at(11, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])

    expect(producedForClosing(value)).toEqual([])
  })

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
    const reader: Parameters<typeof deliverablesDefinition.start>[2] = { previous: () => undefined }
    const state = deliverablesDefinition.start(emptyContext, startMatch, reader)
    const unrelated = matched(at(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }), 'update')
    const context: Parameters<typeof deliverablesDefinition.update>[0] = { ...emptyContext, state }

    expect(() => deliverablesDefinition.start(emptyContext, unrelated, reader))
      .toThrow('deliverables start requires turn/start')
    expect(deliverablesDefinition.update(context, unrelated)).toBe(state)
  })

})

describe('ProducedFiles review card', () => {
  const t = makeTranslate(en)
  const changedReviews: readonly ProducedFileReview[] = [
    fileReview('deep/a.html', [{
      path: 'deep/a.html', oldText: 'before\nkeep', newText: 'after\nkeep', oldStart: 7, newStart: 7,
    }]),
    fileReview('styles/b.css', [{
      path: 'styles/b.css', oldText: null, newText: 'one\ntwo', oldStart: 1, newStart: 1,
    }]),
  ]

  it('derives exact totals for replacements, additions, multiple hunks, and empty reviews', () => {
    expect(summarizeDiffs(changedReviews[0]?.diffs ?? [])).toEqual({ added: 1, removed: 1 })
    expect(summarizeDiffs(changedReviews[1]?.diffs ?? [])).toEqual({ added: 2, removed: 0 })
    expect(summarizeDiffs([])).toEqual({ added: 0, removed: 0 })
    expect(summarizeDiffs([
      { path: 'a.md', oldText: 'x', newText: 'y', oldStart: 1, newStart: 1 },
      { path: 'a.md', oldText: 'same', newText: 'same\nnew', oldStart: 8, newStart: 8 },
    ])).toEqual({ added: 2, removed: 1 })
    expect(unifiedDiffText(changedReviews.flatMap(review => review.diffs)))
      .toContain('styles/b.css\n+ one\n+ two')
  })

  it('renders aggregate and per-file totals with a six-file preview', () => {
    const paths = ['deep/a.html', 'b.css', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts']
    const view = render(<ProducedFiles matched={reviews(paths)} openFile={() => {}} t={t} />)
    const card = view.getByRole('region', { name: 'Edited files' })
    expect(within(card).getByText('Edited 7 files')).toBeTruthy()
    expect(within(card).getByText('1 more file')).toBeTruthy()
    expect(within(card).getAllByRole('button')).toHaveLength(8)
    expect(within(card).queryByRole('button', { name: 'Review g.ts' })).toBeNull()
    const first = within(card).getByRole('button', { name: 'Review deep/a.html' })
    expect(first.textContent).toContain('a.html')
    expect(first.getAttribute('title')).toBe('deep/a.html')
  })

  it('renders the active Web UI language after the locale changes', () => {
    let active = en
    const translate = (key: string, params?: Record<string, unknown>): string =>
      makeTranslate(active)(key, params)
    const view = render(
      <ProducedFiles matched={changedReviews} openFile={() => {}} t={translate} />,
    )

    expect(view.getByRole('region', { name: 'Edited files' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Review all produced files' })).toBeTruthy()

    active = zh
    view.rerender(<ProducedFiles matched={changedReviews} openFile={() => {}} t={translate} />)

    const card = view.getByRole('region', { name: '已编辑文件' })
    expect(within(card).getByText('已编辑 2 个文件')).toBeTruthy()
    expect(within(card).getByLabelText('新增 3 行，删除 1 行')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: '审查所有产出文件' }))

    const drawer = view.getByRole('dialog', { name: '审查' })
    expect(within(drawer).getByText('2 个文件')).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: '复制差异' })).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: '关闭' })).toBeTruthy()
    expect(within(drawer).getByRole('separator', { name: '调整审查面板大小' })).toBeTruthy()
    expect(within(drawer).getAllByRole('button', { name: '在编辑器中打开' })).toHaveLength(2)
  })

  it('switches to reapply only after every reversible file is undone', async () => {
    const inspectChanges = vi.fn(async () => ({ files: [
      { path: 'deep/a.html', state: 'applied' as const, changed: false },
    ] }))
    const applyChanges = vi.fn()
      .mockResolvedValueOnce({ files: [
        { path: 'deep/a.html', state: 'undone', changed: true },
      ] })
      .mockResolvedValueOnce({ files: [
        { path: 'deep/a.html', state: 'applied', changed: true },
      ] })
    const view = render(
      <ProducedFiles
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
    await vi.waitFor(() => { expect(view.getByRole('button', { name: 'Reapply' })).toBeTruthy() })
    expect(view.getByRole('alert').textContent).toContain('Changes undone')
    expect(timeout.mock.calls.some(([, delay]) => delay === 2000)).toBe(true)
    expect(applyChanges.mock.calls[0]?.[0].action).toBe('undo')

    fireEvent.click(view.getByRole('button', { name: 'Reapply' }))
    await vi.waitFor(() => { expect(view.getByRole('button', { name: 'Undo' })).toBeTruthy() })
    expect(view.getByRole('alert').textContent).toContain('Changes reapplied')
    expect(applyChanges.mock.calls[1]?.[0].action).toBe('redo')
  })

  it('keeps Undo in a mixed state and disables it when no file is reversible', async () => {
    const twoReversible = [
      fileReview('deep/a.txt', [{ path: 'deep/a.txt', oldText: 'a', newText: 'A' }]),
      fileReview('nested/b.txt', [{ path: 'nested/b.txt', oldText: 'b', newText: 'B' }]),
    ]
    const inspectChanges = vi.fn(async () => ({ files: [
      { path: 'deep/a.txt', state: 'applied' as const, changed: false },
      { path: 'nested/b.txt', state: 'applied' as const, changed: false },
    ] }))
    const applyChanges = vi.fn(async () => ({ files: [
      { path: 'deep/a.txt', state: 'undone' as const, changed: true },
      { path: 'nested/b.txt', state: 'conflict' as const, changed: false },
    ] }))
    const openFile = vi.fn<(path: string) => void>()
    const view = render(
      <ProducedFiles
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
    await vi.waitFor(() => { expect(view.getByRole('alert')).toBeTruthy() })
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
    act(() => { if (typeof autoClose === 'function') autoClose() })
    expect(view.queryByRole('alert')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await vi.waitFor(() => { expect(applyChanges).toHaveBeenCalledTimes(2) })

    view.rerender(
      <ProducedFiles matched={[fileReview('notes.md')]} openFile={() => {}} t={t} />,
    )
    await vi.waitFor(() => {
      const button = view.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.title).toBe('No safely reversible files are available in this change')
    })
  })

  it('reviews every file from the header and copies the visible unified diff', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const view = render(<ProducedFiles matched={changedReviews} openFile={() => {}} t={t} />)

    fireEvent.click(view.getByRole('button', { name: 'Review all produced files' }))
    const drawer = view.getByRole('dialog', { name: 'Review' })
    expect(within(drawer).getByText('2 files')).toBeTruthy()
    expect(within(drawer).getByText('deep/a.html')).toBeTruthy()
    expect(within(drawer).getByText('styles/b.css')).toBeTruthy()
    expect(drawer.querySelectorAll('[data-diff-layout="unified"]')).toHaveLength(2)

    fireEvent.click(within(drawer).getByRole('button', { name: 'Copy diff' }))
    await vi.waitFor(() => { expect(writeText).toHaveBeenCalledOnce() })
    expect(writeText.mock.calls[0]?.[0]).toContain('deep/a.html')
    expect(writeText.mock.calls[0]?.[0]).toContain('styles/b.css')
    expect(within(drawer).getByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('focuses one file from its row, opens it in the editor, and restores focus on close', () => {
    const openFile = vi.fn<(path: string) => void>()
    const view = render(<ProducedFiles matched={changedReviews} openFile={openFile} t={t} />)
    const trigger = view.getByRole('button', { name: 'Review deep/a.html' })

    fireEvent.click(trigger)
    const drawer = view.getByRole('dialog', { name: 'Review' })
    expect(within(drawer).getByText('1 file')).toBeTruthy()
    expect(within(drawer).queryByText('styles/b.css')).toBeNull()
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Close' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Open in editor' }))
    expect(openFile).toHaveBeenCalledExactlyOnceWith('deep/a.html')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    fireEvent.click(view.getByRole('button', { name: 'Close' }))
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('shows review paths relative to the Session project while opening the absolute path', () => {
    const absolutePath = '/Users/test/projects/example/docs/guide.md'
    const absoluteReview = fileReview(absolutePath, [{
      path: absolutePath, oldText: 'before', newText: 'after', oldStart: 1, newStart: 1,
    }])
    const openFile = vi.fn<(path: string) => void>()
    const view = render(
      <ProducedFiles
        matched={[absoluteReview]}
        openFile={openFile}
        projectRoot="/Users/test/projects/example"
        t={t}
      />,
    )

    fireEvent.click(view.getByRole('button', { name: `Review ${absolutePath}` }))
    const drawer = view.getByRole('dialog', { name: 'Review' })
    expect(within(drawer).getByText('docs/guide.md')).toBeTruthy()
    expect(within(drawer).queryByText(absolutePath)).toBeNull()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Open in editor' }))
    expect(openFile).toHaveBeenCalledExactlyOnceWith(absolutePath)
  })

  it('keeps only one review drawer open across multiple produced-file cards', () => {
    const view = render(
      <>
        <ProducedFiles matched={[fileReview('first.md')]} openFile={() => {}} t={t} />
        <ProducedFiles matched={[fileReview('second.md')]} openFile={() => {}} t={t} />
      </>,
    )

    fireEvent.click(view.getByRole('button', { name: 'Review first.md' }))
    expect(view.getAllByRole('dialog', { name: 'Review' })).toHaveLength(1)
    fireEvent.click(view.getByRole('button', { name: 'Review second.md' }))
    expect(view.getAllByRole('dialog', { name: 'Review' })).toHaveLength(1)
    expect(view.getByRole('dialog', { name: 'Review' }).textContent).toContain('first.md')

    fireEvent.click(within(view.getByRole('dialog', { name: 'Review' }))
      .getByRole('button', { name: 'Close' }))
    fireEvent.click(view.getByRole('button', { name: 'Review second.md' }))
    expect(view.getAllByRole('dialog', { name: 'Review' })).toHaveLength(1)
    expect(view.getByRole('dialog', { name: 'Review' }).textContent).toContain('second.md')
  })

  it('resizes the drawer by dragging or keyboard and persists the chosen width', () => {
    const innerWidth = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024)
    const view = render(<ProducedFiles matched={changedReviews} openFile={() => {}} t={t} />)
    fireEvent.click(view.getByRole('button', { name: 'Review all produced files' }))
    const drawer = view.getByRole('dialog', { name: 'Review' })
    const handle = within(drawer).getByRole('separator', { name: 'Resize review panel' })

    expect(handle.getAttribute('aria-valuenow')).toBe('369')
    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 500 })
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 400 })
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 400 })
    expect(drawer.style.getPropertyValue('--review-drawer-width')).toBe('45.77vw')
    expect(window.localStorage.getItem('dsh-file-review:drawer-ratio')).toBe('0.4577')

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(drawer.style.getPropertyValue('--review-drawer-width')).toBe('43.77vw')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(drawer.style.getPropertyValue('--review-drawer-width')).toBe('24vw')

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    innerWidth.mockReturnValue(1440)
    fireEvent(window, new Event('resize'))
    expect(drawer.style.getPropertyValue('--review-drawer-width')).toBe('26vw')
    expect(handle.getAttribute('aria-valuenow')).toBe('374')

    fireEvent.doubleClick(handle)
    expect(drawer.style.getPropertyValue('--review-drawer-width')).toBe('')
    expect(window.localStorage.getItem('dsh-file-review:drawer-ratio')).toBeNull()
  })

  it('uses the host details track instead of covering the conversation', () => {
    const view = render(
      <div
        data-testid="host-frame"
        style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr) 0px' }}
      >
        <aside style={{ width: 280 }} />
        <main>
          <ProducedFiles matched={changedReviews} openFile={() => {}} t={t} />
        </main>
        <aside data-testid="host-details">Native details</aside>
      </div>,
    )
    const frame = view.getByTestId('host-frame')
    const details = view.getByTestId('host-details')

    fireEvent.click(view.getByRole('button', { name: 'Review all produced files' }))
    expect(frame.style.gridTemplateColumns)
      .toBe('280px minmax(0, 1fr) var(--dsh-file-review-drawer-width)')
    expect(frame.style.getPropertyValue('--dsh-file-review-drawer-width')).toBe('36vw')
    expect(details.style.visibility).toBe('hidden')
    expect(details.style.pointerEvents).toBe('none')
    expect(details.getAttribute('aria-hidden')).toBe('true')
    const drawer = view.getByRole('dialog', { name: 'Review' })
    expect(drawer.className).toContain('drawerSplit')

    const handle = within(drawer).getByRole('separator', { name: 'Resize review panel' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(frame.style.getPropertyValue('--dsh-file-review-drawer-width')).toBe('38vw')

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(frame.style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 0px')
    expect(frame.style.getPropertyValue('--dsh-file-review-drawer-width')).toBe('')
    expect(details.style.visibility).toBe('')
    expect(details.style.pointerEvents).toBe('')
    expect(details.getAttribute('aria-hidden')).toBeNull()
  })

  it('explains unavailable diffs and disables copying while keeping editor access', () => {
    const openFile = vi.fn<(path: string) => void>()
    const view = render(
      <ProducedFiles matched={[fileReview('notes.md')]} openFile={openFile} t={t} />,
    )
    fireEvent.click(view.getByRole('button', { name: 'Review notes.md' }))
    const drawer = view.getByRole('dialog', { name: 'Review' })
    expect(within(drawer).getByText(
      'No reconstructable diff is available for this change. You can still open the current file.',
    )).toBeTruthy()
    expect((within(drawer).getByRole('button', { name: 'Copy diff' }) as HTMLButtonElement).disabled)
      .toBe(true)
    fireEvent.click(within(drawer).getByRole('button', { name: 'Open in editor' }))
    expect(openFile).toHaveBeenCalledExactlyOnceWith('notes.md')
  })
})

describe('producedFileMentions resolver', () => {
  const label = (path: string) => `Open ${path}`

  it('resolves exact paths and unique basenames; ambiguity and unknowns stay unresolved', () => {
    const opened: string[] = []
    const resolver = producedFileMentions(
      ['out/index.html', 'a/style.css', 'b/style.css'],
      (path) => { opened.push(path) },
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

describe('plugin registration', () => {
  it('registers the Remote, turn definition, tail entry, dictionaries, and mention service', async () => {
    let definition: unknown
    let slot: {
      options: { inject?: (sessionId: string) => unknown; locale?: string; name?: string }
      component: unknown
    } | undefined
    let service: ChatFileMentions | undefined
    const registerLocale = vi.fn(() => () => {})
    const disposeRemote = vi.fn(async () => {})
    const mountRemote = vi.fn(async () => disposeRemote)
    class RemoteFixture extends Service {
      constructor(scoped: Context) { super(scoped, 'remote') }
    }
    class FileReviewRemoteFixture extends Service {
      constructor(scoped: Context) { super(scoped, 'remote.fileReview') }
      async status(): Promise<{ ok: true; value: { files: readonly [] } }> {
        return { ok: true, value: { files: [] } }
      }
      async apply(): Promise<{ ok: true; value: { files: readonly [] } }> {
        return { ok: true, value: { files: [] } }
      }
    }
    const cordis = new Context()
    const remoteFixture = cordis.plugin({ apply: scoped => { new RemoteFixture(scoped) } })
    const fileReviewFixture = cordis.plugin({
      apply: scoped => { new FileReviewRemoteFixture(scoped) },
    })
    await Promise.all([remoteFixture, fileReviewFixture])
    // Match SessionRuntime: its Agent-scope fiber knows the root Remote service,
    // but not feature namespaces mounted after the runtime started.
    const sessionScope = cordis.plugin({ inject: ['remote'], apply: () => {} })
    await sessionScope
    const ctx = {
      remote: { $mount: mountRemote },
      sessions: {
        scope: vi.fn(() => sessionScope.ctx),
        list: { getSnapshot: () => ({ byId: {
          'session-1': { cwd: '/workspace/project' },
        } }) },
      },
      conversationEvents: { register: (value: unknown) => { definition = value; return () => {} } },
      effect: (setup: () => void) => { setup() },
      locale: { register: registerLocale, bind: () => makeTranslate(en) },
      slots: {
        inject: (_name: string, setup: () => void) => { setup() },
        register: (
          options: { inject?: (sessionId: string) => unknown; locale?: string; name?: string },
          component: unknown,
        ) => {
          slot = { options, component }
          return () => {}
        },
      },
      provide: (name: string, value: ChatFileMentions) => {
        if (name === 'chatFileMentions') service = value
      },
    }

    const dispose = await apply(ctx as never)
    expect(inject).toEqual(['slots', 'locale', 'conversationEvents', 'remote', 'sessions'])
    expect(mountRemote).toHaveBeenCalledOnce()
    expect(definition).toBe(deliverablesDefinition)
    expect(registerLocale).toHaveBeenCalledWith('file-review', { zh, en })
    expect(slot?.component).toBe(ProducedFiles)
    expect(slot?.options.locale).toBe(NS)
    expect(slot?.options.inject).toBeTypeOf('function')
    const reviewActions = slot?.options.inject?.('session-1') as {
      projectRoot?: string
      inspectChanges(request: {
        action: 'undo'
        files: readonly []
      }): Promise<{ files: readonly [] }>
      applyChanges(request: {
        action: 'undo'
        files: readonly []
      }): Promise<{ files: readonly [] }>
    }
    expect(reviewActions.projectRoot).toBe('/workspace/project')
    await expect(reviewActions.inspectChanges({ action: 'undo', files: [] }))
      .resolves.toEqual({ files: [] })
    await expect(reviewActions.applyChanges({ action: 'undo', files: [] }))
      .resolves.toEqual({ files: [] })

    const opened: string[] = []
    const owner = tailOwner(
      produced([2, 'site/report.html']),
      3,
      (path) => { opened.push(path) },
    )
    const mentions = service?.forClosing(owner)
    mentions?.resolve('report.html')?.open()
    expect(opened).toEqual(['site/report.html'])
    expect(service?.forClosing(tailOwner(undefined, 2))).toBeUndefined()
    await dispose()
    expect(disposeRemote).toHaveBeenCalledOnce()
    await sessionScope.dispose()
    await fileReviewFixture.dispose()
    await remoteFixture.dispose()
  })
})
