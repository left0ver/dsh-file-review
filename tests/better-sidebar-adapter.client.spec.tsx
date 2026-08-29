import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { installBetterSidebarIntegration } from '../src/client/better-sidebar-adapter.tsx'
import { reviewHost } from '../src/client/review-host.ts'

interface CapturedTabDescriptor {
  readonly component: (props: {
    readonly scope: { readonly sessionId: string }
    readonly tab: { readonly meta?: unknown }
    readonly visible: boolean
  }) => ReactNode
}

describe('better-sidebar review tab adapter', () => {
  it('updates an open tab title when the active locale changes', () => {
    let active: 'zh' | 'en' = 'zh'
    let publishLocale = () => {}
    let disposeEffect: (() => void) | undefined
    const updateTab = vi.fn()
    const service = {
      features: ['tabMeta', 'updateTab', 'targetedOpen', 'openFile'],
      registerTab: vi.fn((_value: CapturedTabDescriptor) => () => {}),
      isTabEnabled: vi.fn(() => true),
      updateTab,
      openTab: vi.fn(),
      activateTab: vi.fn(),
      openFile: vi.fn(),
    }
    const ctx = {
      inject: (
        _dependencies: readonly string[],
        install: (scoped: {
          get: (name: string) => unknown
          effect: (mount: () => (() => void) | undefined) => void
        }) => void,
      ) => {
        install({
          get: () => service,
          effect: (mount) => {
            disposeEffect = mount()
          },
        })
      },
    }
    const t = (key: string): string => {
      if (key === 'review.title') return active === 'zh' ? '审查' : 'Review'
      return key
    }

    installBetterSidebarIntegration(ctx as never, {
      sessions: {} as never,
      wordWrap: {} as never,
      locale: {
        subscribe: (listener: () => void) => {
          publishLocale = listener
          return () => {
            publishLocale = () => {}
          }
        },
      },
      t: t as never,
      runtimeFor: () => ({
        inspectChanges: async () => ({ files: [] }),
        applyChanges: async () => ({ files: [] }),
      }),
    })

    try {
      expect(
        reviewHost.open({
          sessionId: 'session-1',
          target: { turn: 1, closingSeq: 2, focusPaths: ['README.md'] },
        }),
      ).toBe(true)
      updateTab.mockClear()

      active = 'en'
      publishLocale()

      expect(updateTab).toHaveBeenLastCalledWith('dsh-file-review:review', { title: 'Review' })
    } finally {
      disposeEffect?.()
    }
  })
})
