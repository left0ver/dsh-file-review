// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { installNativeSidebarIntegration } from '../src/client/native-sidebar-adapter.tsx'
import { ProducedFiles } from '../src/client/ProducedFiles.tsx'
import { en } from '../src/client/locales.ts'

vi.mock('../src/client/FileReviewTab.tsx', () => ({
  FileReviewTab: ({
    sessionId,
    params,
    visible,
    openFile,
  }: {
    sessionId: string
    params: unknown
    visible: boolean
    openFile(path: string): void
  }) => (
    <div data-session={sessionId} data-visible={String(visible)}>
      <output>{JSON.stringify(params)}</output>
      <button onClick={() => openFile('/workspace/中文 #.md')}>Open file</button>
    </div>
  ),
}))

afterEach(cleanup)

function fixture(withBetterSidebar: boolean) {
  const disposers: Array<() => void> = []
  const slots = new Map<string, ComponentType<any>>()
  const definitions: unknown[] = []
  const openTabIn = vi.fn()
  const ctx = {
    sidebarRight: { openTabIn },
    sidebarRightTabs: {
      register: vi.fn((definition) => {
        definitions.push(definition)
        return () => {
          definitions.splice(definitions.indexOf(definition), 1)
        }
      }),
    },
    effect: (setup: () => () => void) => {
      const dispose = setup()
      disposers.push(dispose)
      return dispose
    },
    slots: {
      inject: (_name: string, setup: () => () => void) => setup(),
      register: (definition: { name: string; key: string }, component: ComponentType<any>) => {
        expect(definition.key).toBe('dsh-file-review:review')
        slots.set(definition.name, component)
        return () => {
          slots.delete(definition.name)
        }
      },
    },
    get betterSidebar() {
      if (withBetterSidebar) throw new Error('Native integration must not access betterSidebar')
      return undefined
    },
  }
  const t = (key: keyof typeof en) => en[key]
  const open = installNativeSidebarIntegration(ctx as never, {
    sessions: {} as never,
    uiConversation: {} as never,
    wordWrap: { getSnapshot: () => false, subscribe: () => () => {} },
    t,
    runtimeFor: () => ({
      inspectChanges: async () => ({ files: [] }),
      applyChanges: async () => ({ files: [] }),
    }),
  })
  return {
    open,
    openTabIn,
    slots,
    definitions,
    dispose: () => {
      for (const off of disposers.reverse()) off()
    },
  }
}

describe('native sidebar review registration', () => {
  it.each([false, true])(
    'registers and opens independently of betterSidebar (installed: %s)',
    (installed) => {
      const f = fixture(installed)
      const first = { turn: 1, closingSeq: 10, focusPaths: ['a.md'] }
      const second = { turn: 2, closingSeq: 20, focusPaths: ['b.md'] }
      f.open('session-a' as never, first)
      f.open('session-a' as never, second)
      f.open('session-b' as never, first)
      expect(f.definitions).toHaveLength(1)
      expect(f.openTabIn.mock.calls).toEqual([
        ['session-a', 'dsh-file-review:review', { params: first }],
        ['session-a', 'dsh-file-review:review', { params: second }],
        ['session-b', 'dsh-file-review:review', { params: first }],
      ])
      f.dispose()
      expect(f.definitions).toHaveLength(0)
      expect(f.slots.size).toBe(0)
    },
  )

  it('reads current navigation and visibility, routes files in the tab session, and localizes its title', () => {
    const f = fixture(false)
    const Body = f.slots.get('sidebar.right.pane.tab')!
    const Title = f.slots.get('sidebar.right.pane.tab.title')!
    const openResource = vi.fn()
    const props = (turn: number, visible: boolean) => ({
      sessionId: 'session-a',
      t: (key: keyof typeof en) => en[key],
      useSessions: (select: (value: unknown) => unknown) =>
        select({ byId: { 'session-a': { cwd: '/workspace' } } }),
      useTabInfo: () => ({
        tab: {
          id: 'host-generated-id',
          visible,
          navigation: { params: { turn, closingSeq: 10, focusPaths: [] } },
          actions: { openResource },
        },
      }),
    })
    const view = render(<Body {...props(1, true)} />)
    expect(JSON.parse(view.getByRole('status').textContent!)).toMatchObject({ turn: 1 })
    view.rerender(<Body {...props(2, false)} />)
    expect(JSON.parse(view.getByRole('status').textContent!)).toMatchObject({ turn: 2 })
    expect(view.container.firstElementChild?.getAttribute('data-visible')).toBe('false')
    fireEvent.click(view.getByRole('button', { name: 'Open file' }))
    expect(openResource).toHaveBeenCalledWith(
      'dsh-resource://file/session/session-a/%E4%B8%AD%E6%96%87%20%23.md',
    )
    view.rerender(<Title t={() => '审查'} />)
    expect(view.getByText('审查')).toBeTruthy()
    view.rerender(<Title t={() => 'Review'} />)
    expect(view.getByText('Review')).toBeTruthy()
    f.dispose()
  })

  it('sends all-file and single-file targets from the real card without opening a drawer', () => {
    const openReview = vi.fn()
    const view = render(
      <ProducedFiles
        matched={[
          { path: 'a.md', diffs: [] },
          { path: 'b.md', diffs: [] },
        ]}
        turn={{ turn: 3 } as never}
        seq={12}
        openReview={openReview}
        openFile={() => {}}
        t={(key, params) => String(en[key]).replace('{name}', String(params?.name))}
      />,
    )
    fireEvent.click(view.getByRole('button', { name: en['produced.reviewAll'] }))
    fireEvent.click(view.getByRole('button', { name: 'Review b.md' }))
    expect(openReview.mock.calls).toEqual([
      [{ turn: 3, closingSeq: 12, focusPaths: ['a.md', 'b.md'] }],
      [{ turn: 3, closingSeq: 12, focusPaths: ['b.md'] }],
    ])
    expect(view.queryByRole('dialog')).toBeNull()
  })
})
