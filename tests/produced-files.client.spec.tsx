// @vitest-environment jsdom
/**
 * dsh-file-review browser half: the derivation contract of
 * `producedForClosing` over engine-published Turn data, the row's rendering
 * and opener wiring, plus the plugin's public service registrations.
 */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ConversationEventInput, ConversationLocationDataStore, ConversationMatch,
  ConversationTurnDataMap, ToolResultNode, TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatFileMentions, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  fitProducedFiles, ProducedFiles, type ProducedFilesProps,
} from '../src/client/ProducedFiles.tsx'
import {
  basename, deliverablesDefinition, producedFileMentions, producedForClosing, reviewsForClosing,
  selectProducedFiles, type DeliverablesTurnData, type ProducedFileDiff, type ProducedFileReview,
} from '../src/client/turn-deliverables.ts'
import { apply, inject } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'

const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalClientWidth === undefined) {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  } else {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
  }
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

describe('ProducedFiles row', () => {
  const t = makeTranslate(zh)
  const capability = (
    canOpenPath: boolean | undefined,
    isLoopback = true,
  ): Pick<ProducedFilesProps, 'isLoopback' | 'useHostDescription'> => {
    const description = canOpenPath === undefined
      ? undefined
      : { version: 'test', cwd: '/workspace', attachedSessions: 1, canOpenPath }
    return {
      isLoopback,
      useHostDescription: selector => selector(description),
    }
  }

  it('selects the largest prefix using the exact remainder width', () => {
    expect(fitProducedFiles(230, 8, [70, 60, 60], [55, 55, 55, 55])).toBe(2)
    expect(fitProducedFiles(145, 8, [70, 60, 60], [55, 55, 55, 55])).toBe(1)
    expect(fitProducedFiles(300, 8, [70, 60, 60], [55, 55, 55, 55])).toBe(3)
    // A zero-width lane is a pre-layout test/hidden state, not evidence that
    // every chip overflowed; keep the bounded initial prefix until measured.
    expect(fitProducedFiles(0, 8, [70, 60], [60, 50, undefined])).toBe(2)
    expect(fitProducedFiles(128, 8, [60, 60], [70, 50, undefined])).toBe(2)
    // Candidate-specific suffix widths matter at the 10 -> 9 digit boundary.
    expect(fitProducedFiles(126, 8, [60], [70, 50])).toBe(1)
    expect(fitProducedFiles(20, 8, [60], [70, 50])).toBe(0)
  })

  it('keeps one measured line, updates on resize, and opens a file or the workspace folder', () => {
    const paths = ['deep/a.html', 'b.css', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts']
    const openFile = vi.fn<(path: string) => void>()
    let available = 226
    let resize: ResizeObserverCallback | undefined
    const disconnect = vi.fn()
    const observeNode = vi.fn<(target: Element) => void>()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback }
      observe(target: Element): void {
        expect(target).toBeInstanceOf(Element)
        observeNode(target)
      }
      disconnect(): void { disconnect() }
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) { return this.hasAttribute('data-produced-files-row') ? available : 0 },
    })
    const rect = (width: number): DOMRect => ({
      x: 0, y: 0, width, height: 22, top: 0, right: width, bottom: 22, left: 0,
      toJSON: () => ({}),
    })
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getProbeRect(this: HTMLElement) {
        if (this.closest('[aria-hidden="true"]') === null) return rect(0)
        if (this.tagName !== 'BUTTON') return rect(60)
        return rect(this.textContent === 'a.html' || this.textContent === 'b.css' ? 50 : 100)
      })

    const view = render(
      <ProducedFiles matched={reviews(paths)} openFile={openFile} {...capability(true)} t={t} />,
    )
    expect(view.getByText('Produced')).toBeTruthy()
    const row = view.container.querySelector('[data-produced-files-row]')
    if (!(row instanceof HTMLElement)) throw new Error('produced row missing')
    // The third probe is 100px: two chips plus the remainder fit, three do not.
    expect(within(row).getAllByRole('button')).toHaveLength(2)
    expect(within(row).getByText('+ 5 files')).toBeTruthy()
    const chip = view.getByRole('button', { name: 'Review deep/a.html' })
    expect(chip.textContent).toBe('a.html')
    expect(chip.getAttribute('title')).toBe('deep/a.html')
    expect(view.queryByRole('button', { name: 'Review g.ts' })).toBeNull()
    fireEvent.click(chip)
    expect(openFile).not.toHaveBeenCalled()
    expect(view.getByRole('dialog', { name: 'Review deep/a.html' })).toBeTruthy()
    expect(view.getByText('before')).toBeTruthy()
    expect(view.getByText('after')).toBeTruthy()
    expect(document.querySelector('[data-diff-layout="unified"]')).toBeTruthy()
    expect(document.querySelector('[data-line-kind="del"][data-old-line="7"]')).toBeTruthy()
    expect(document.querySelector('[data-line-kind="add"][data-new-line="7"]')).toBeTruthy()
    expect(view.getByText('6 unchanged lines')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Open in editor' }))
    expect(openFile).toHaveBeenCalledWith('deep/a.html')

    const showFolder = view.getByRole('button', { name: 'Show in folder' })
    fireEvent.click(showFolder)
    expect(openFile).toHaveBeenLastCalledWith('.')

    available = 150
    act(() => { resize?.([], {} as ResizeObserver) })
    expect(within(row).getAllByRole('button')).toHaveLength(1)
    expect(within(row).getByText('+ 6 files')).toBeTruthy()

    // A missing/unsupported computed gap falls back to zero rather than NaN.
    vi.stubGlobal('getComputedStyle', () => ({ columnGap: '', gap: '' } as CSSStyleDeclaration))
    available = 165
    act(() => { resize?.([], {} as ResizeObserver) })
    expect(within(row).getAllByRole('button')).toHaveLength(2)

    // Ref callbacks leave nulls in the probe arrays when the candidate set
    // shrinks; the replacement observer must skip those stale slots.
    observeNode.mockClear()
    view.rerender(
      <ProducedFiles matched={reviews(paths.slice(0, 1))} openFile={openFile} {...capability(true)} t={t} />,
    )
    expect(within(row).getAllByRole('button')).toHaveLength(1)
    expect(observeNode).toHaveBeenCalledTimes(3)

    view.unmount()
    expect(disconnect).toHaveBeenCalledTimes(2)
    bounds.mockRestore()
  })

  it('keeps the folder action absent without overflow or a local native opener', () => {
    const openFile = vi.fn<(path: string) => void>()
    const view = render(
      <ProducedFiles matched={reviews(['a.md'])} openFile={openFile} {...capability(true)} t={t} />,
    )
    const overflowing = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md', 'g.md']
    expect(view.queryByRole('button', { name: 'Show in folder' })).toBeNull()
    for (const unavailable of [capability(false), capability(true, false), capability(undefined)]) {
      view.rerender(<ProducedFiles matched={reviews(overflowing)} openFile={openFile} {...unavailable} t={t} />)
      expect(view.queryByRole('button', { name: 'Show in folder' })).toBeNull()
    }
  })

  it('uses singular English copy when exactly one file is hidden', () => {
    const view = render(
      <ProducedFiles
        matched={reviews(['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md', 'g.md'])}
        openFile={() => {}}
        {...capability(false)}
        t={makeTranslate(en)}
      />,
    )
    const row = view.container.querySelector('[data-produced-files-row]')
    if (!(row instanceof HTMLElement)) throw new Error('produced row missing')
    expect(within(row).getByText('+ 1 file')).toBeTruthy()
  })

  it('explains an unavailable diff and supports every close path', () => {
    const openFile = vi.fn<(path: string) => void>()
    const view = render(
      <ProducedFiles matched={[fileReview('notes.md')]} openFile={openFile} {...capability(false)} t={t} />,
    )
    const openReview = () => { fireEvent.click(view.getByRole('button', { name: 'Review notes.md' })) }

    openReview()
    expect(view.getByText('No reconstructable diff is available for this change. You can still open the current file.')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()

    openReview()
    const closeButtons = view.getAllByRole('button', { name: 'Close' })
    fireEvent.click(closeButtons.at(-1) as HTMLButtonElement)
    expect(view.queryByRole('dialog')).toBeNull()

    openReview()
    fireEvent.click(view.getByRole('button', { name: 'Open in editor' }))
    expect(openFile).toHaveBeenCalledExactlyOnceWith('notes.md')
    expect(view.queryByRole('dialog')).toBeNull()
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
  it('registers the turn definition, tail entry, dictionaries, and mention service', () => {
    const hostDescription = { getSnapshot: () => undefined, subscribe: () => () => {} }
    const connection = {
      api: { settings: {} },
      isLoopback: false,
      hostDescription,
    }
    let definition: unknown
    let slot: { options: { inject?: () => unknown }; component: unknown } | undefined
    let service: ChatFileMentions | undefined
    const registerLocale = vi.fn(() => () => {})
    const ctx = {
      get: () => connection,
      conversationEvents: { register: (value: unknown) => { definition = value; return () => {} } },
      effect: (setup: () => void) => { setup() },
      locale: { register: registerLocale, bind: () => makeTranslate(en) },
      slots: {
        inject: (_name: string, setup: () => void) => { setup() },
        register: (options: { inject?: () => unknown }, component: unknown) => {
          slot = { options, component }
          return () => {}
        },
      },
      provide: (name: string, value: ChatFileMentions) => {
        if (name === 'chatFileMentions') service = value
      },
    }

    apply(ctx as never)
    expect(inject).toEqual(['slots', 'locale', 'conversationEvents', 'connection'])
    expect(definition).toBe(deliverablesDefinition)
    expect(registerLocale).toHaveBeenCalledWith('file-review', { zh, en })
    expect(slot?.component).toBe(ProducedFiles)
    expect(slot?.options.inject?.()).toEqual({ isLoopback: false, hooks: { hostDescription } })

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
  })
})
