// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type {
  SettingsScope,
  SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { Config, DiffLayout } from '../src/settings-contract.ts'
import { ReviewContent } from '../src/client/ReviewContent.tsx'
import {
  FileReviewSettingsCard,
  type FileReviewSettingsCardProps,
} from '../src/client/FileReviewSettingsCard.tsx'
import { clearAllReviewComments, reviewComments } from '../src/client/review-comments.ts'
import { en, type DeliverablesKey } from '../src/client/locales.ts'

const t = (key: DeliverablesKey, params?: Record<string, string>) =>
  en[key].replace(/\{([^}]+)\}/g, (_, name: string) => params?.[name] ?? '')
const reviews = [
  {
    path: 'example.ts',
    diffs: [
      {
        path: 'example.ts',
        oldText: 'before\nremoved\nkeep\ntail',
        newText: 'after\nkeep\nextra\nlast\ntail',
        oldStart: 1,
        newStart: 1,
      },
    ],
  },
]

function settingsScope(diffLayout?: DiffLayout): SettingsScope<Config> {
  let snapshot: SettingsScopeSnapshot<Config> = {
    status: 'ready',
    value: diffLayout === undefined ? {} : { diffLayout },
    base: {},
    user: {},
    revision: 1,
    writable: true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: vi.fn(async (field, value) => {
      snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value } }
      for (const listener of listeners) listener()
    }),
    unset: vi.fn(),
    mutate: vi.fn(),
  }
}

function Review({ settings }: { settings: SettingsScope<Config> }) {
  return (
    <ReviewContent
      reviews={reviews}
      sessionId="split-test"
      turn={1}
      closingSeq={2}
      settings={settings}
      openFile={() => {}}
      t={t}
    />
  )
}

afterEach(() => {
  cleanup()
  clearAllReviewComments()
})

// 验证左右配对、纯新增/删除占位及原始行号；上下文不允许新增评论。
it('defaults to split and aligns unequal change blocks without inventing lines', () => {
  const view = render(<Review settings={settingsScope()} />)
  expect(view.container.querySelector('[data-diff-layout="split"]')).not.toBeNull()
  const left = view.container.querySelector('[data-diff-side="left"]')!
  const right = view.container.querySelector('[data-diff-side="right"]')!
  const lines = (pane: Element) =>
    [...pane.querySelectorAll('[data-split-row]')].map(
      (row) => row.querySelector('[data-line-kind]')?.lastElementChild?.textContent ?? null,
    )
  expect(lines(left)).toEqual(['before', 'removed', 'keep', null, null, 'tail'])
  expect(lines(right)).toEqual(['after', null, 'keep', 'extra', 'last', 'tail'])
  expect(left.querySelector('[data-line-kind="add"]')).toBeNull()
  expect(right.querySelector('[data-line-kind="del"]')).toBeNull()
  for (const row of view.container.querySelectorAll('[data-line-kind="context"]')) {
    expect(row.querySelector('button')).toBeNull()
  }
  expect(right.querySelector('[data-line-kind="context"]')?.getAttribute('data-new-line')).toBe('2')
})

// 验证两种布局下左右同号行独立评论，切换行与布局丢弃草稿，已保存评论不串行。
it.each<DiffLayout>(['split', 'unified'])(
  'keeps changed-line comments stable from %s',
  async (layout) => {
    const settings = settingsScope(layout)
    const view = render(<Review settings={settings} />)
    const button = (kind: string) =>
      within(view.container.querySelector(`[data-line-kind="${kind}"]`) as HTMLElement).getByRole(
        'button',
      )
    fireEvent.click(button('del'))
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'discard draft' } })
    fireEvent.click(button('add'))
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'new side comment' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    fireEvent.click(button('del'))
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'old side comment' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    expect(
      reviewComments('split-test').map((comment) => [
        comment.anchor.kind,
        comment.anchor.rowIndex,
        comment.body,
      ]),
    ).toEqual([
      ['add', 2, 'new side comment'],
      ['del', 0, 'old side comment'],
    ])
    fireEvent.click(button('del'))
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'unsaved edit' } })
    await act(async () => {
      fireEvent.change(view.getByRole('combobox', { name: 'Diff layout' }), {
        target: { value: layout === 'split' ? 'unified' : 'split' },
      })
    })
    expect(view.queryByRole('textbox')).toBeNull()
    expect(view.getByText('old side comment')).toBeTruthy()
    expect(view.getByText('new side comment')).toBeTruthy()
    for (const row of view.container.querySelectorAll('[data-line-kind="context"]'))
      expect(row.querySelector('button')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'old side comment' }))
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'updated old comment' } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    expect(
      reviewComments('split-test').find((comment) => comment.anchor.kind === 'del')?.body,
    ).toBe('updated old comment')
  },
)

// 验证设置页和审查页共享同一个设置，重开沿用设置；失败时保留原模式并显示错误。
it('synchronizes settings and review controls and keeps the chosen layout on reopen', async () => {
  const settings = settingsScope()
  function Settings() {
    const props = {
      t,
      useFileReviewSettings: (select: (snapshot: SettingsScopeSnapshot<Config>) => unknown) =>
        select(useSyncExternalStore(settings.subscribe, settings.getSnapshot)),
      setWordWrap: (value: boolean) => settings.set('wordWrap', value),
      setDiffLayout: (value: DiffLayout) => settings.set('diffLayout', value),
    } as unknown as FileReviewSettingsCardProps
    return (
      <ul>
        <FileReviewSettingsCard {...props} />
      </ul>
    )
  }
  const view = render(
    <>
      <Settings />
      <Review settings={settings} />
    </>,
  )
  fireEvent.click(view.getByRole('button', { name: 'Expand: File review' }))
  const selectors = view.getAllByRole('combobox', { name: 'Diff layout' })
  await act(async () => {
    fireEvent.change(selectors[1]!, { target: { value: 'unified' } })
  })
  expect(settings.set).toHaveBeenCalledWith('diffLayout', 'unified')
  expect(selectors.map((select) => (select as HTMLSelectElement).value)).toEqual([
    'unified',
    'unified',
  ])
  view.unmount()
  const reopened = render(
    <>
      <Settings />
      <Review settings={settings} />
    </>,
  )
  expect(reopened.container.querySelector('[data-diff-layout="unified"]')).not.toBeNull()
  fireEvent.click(reopened.getByRole('button', { name: 'Expand: File review' }))
  await act(async () => {
    fireEvent.change(reopened.getAllByRole('combobox')[0]!, { target: { value: 'split' } })
  })
  expect(reopened.container.querySelector('[data-diff-layout="split"]')).not.toBeNull()
  vi.mocked(settings.set).mockRejectedValueOnce(new Error('write failed'))
  await act(async () => {
    fireEvent.change(reopened.getAllByRole('combobox')[1]!, { target: { value: 'unified' } })
  })
  expect(reopened.getByRole('alert').textContent).toContain('Could not save')
  expect(reopened.container.querySelector('[data-diff-layout="split"]')).not.toBeNull()
})

// 验证跨文件打开另一行评论也会丢弃原来的草稿，只保留当前编辑器。
it('discards an unsaved draft when opening a comment in another file', () => {
  const view = render(
    <ReviewContent
      reviews={[
        ...reviews,
        {
          path: 'second.ts',
          diffs: [{ path: 'second.ts', oldText: null, newText: 'new file', newStart: 1 }],
        },
      ]}
      sessionId="split-test"
      turn={1}
      closingSeq={2}
      settings={settingsScope()}
      openFile={() => {}}
      t={t}
    />,
  )
  fireEvent.click(view.getAllByRole('button', { name: 'Add comment on line 1' })[0]!)
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'discard across files' } })
  fireEvent.click(view.getAllByRole('button', { name: 'Add comment on line 1' }).at(-1)!)
  expect(view.getAllByRole('textbox')).toHaveLength(1)
  expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  expect(reviewComments('split-test')).toHaveLength(0)
})

// 验证任一侧横向滚动都会同步另一侧；短侧到达边缘后不反向拉回长侧。
it('synchronizes horizontal scrolling in both directions without clamped feedback', () => {
  const view = render(<Review settings={settingsScope()} />)
  const left = view.container.querySelector<HTMLElement>('[data-diff-side="left"]')!
  const right = view.container.querySelector<HTMLElement>('[data-diff-side="right"]')!
  left.scrollLeft = 80
  fireEvent.scroll(left)
  expect(right.scrollLeft).toBe(80)
  fireEvent.scroll(right)
  right.scrollLeft = 30
  fireEvent.scroll(right)
  expect(left.scrollLeft).toBe(30)
  fireEvent.scroll(left)

  let shortOffset = 30
  Object.defineProperty(right, 'scrollLeft', {
    configurable: true,
    get: () => shortOffset,
    set: (value: number) => {
      shortOffset = Math.min(value, 50)
    },
  })
  left.scrollLeft = 200
  fireEvent.scroll(left)
  expect(right.scrollLeft).toBe(50)
  fireEvent.scroll(right)
  expect(left.scrollLeft).toBe(200)
  right.scrollLeft = 10
  fireEvent.scroll(right)
  expect(left.scrollLeft).toBe(10)
})
