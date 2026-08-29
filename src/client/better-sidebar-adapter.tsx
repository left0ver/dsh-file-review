/** Dynamically-scoped optional adapter for dsh-better-sidebar. */

import type { ReactNode } from 'react'
import type {
  ClientContext,
  ISessions,
  ObservableSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { FileReviewTab, type FileReviewTabRuntime } from './FileReviewTab.tsx'
import { attachReviewHost, type ReviewHostAdapter } from './review-host.ts'
import type { NS } from './locales.ts'

const REVIEW_TAB_ID = 'dsh-file-review:review'
const REQUIRED_FEATURES = ['tabMeta', 'updateTab', 'targetedOpen', 'openFile'] as const

/** Minimal structural mirror of the optional service; no runtime package import is emitted. */
interface SidebarScope {
  readonly sessionId: string
  readonly cwd?: string | undefined
}

interface SidebarTab {
  readonly meta?: unknown
}

interface TabComponentProps {
  readonly scope: SidebarScope
  readonly tab: SidebarTab
  readonly visible: boolean
}

interface TabDescriptor {
  readonly id: string
  readonly title: string | (() => string)
  readonly icon?: ((size: number) => ReactNode) | undefined
  readonly order?: number | undefined
  readonly hidden?: boolean | undefined
  readonly single?: boolean | undefined
  readonly component: (props: TabComponentProps) => ReactNode
}

interface OpenTabSeed {
  readonly type: string
  readonly title?: string | undefined
  readonly path?: string | undefined
  readonly id?: string | undefined
  readonly meta?: unknown
}

interface BetterSidebarService {
  readonly features: readonly string[]
  registerTab(descriptor: TabDescriptor): () => void
  isTabEnabled(tabId: string): boolean
  updateTab(tabId: string, patch: { title?: string; path?: string; meta?: unknown }): void
  openTab(seed: OpenTabSeed, scope?: SidebarScope): void
  activateTab(tabId: string, scope?: SidebarScope): void
  openFile(scope: SidebarScope, path: string, title?: string): void
}

function ReviewTabIcon({ size }: { readonly size: number }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    >
      <path d="M4 3.5h8.5a1 1 0 0 1 1 1V8M6.5 6.5h4M6.5 9.5h2" />
      <path d="m10 13 1.75 1.75L16 10.5" />
    </svg>
  )
}

function supportsReviewTab(value: unknown): value is BetterSidebarService {
  if (typeof value !== 'object' || value === null) return false
  const service = value as Partial<BetterSidebarService>
  return (
    Array.isArray(service.features) &&
    REQUIRED_FEATURES.every((feature) => service.features?.includes(feature)) &&
    typeof service.registerTab === 'function' &&
    typeof service.isTabEnabled === 'function' &&
    typeof service.updateTab === 'function' &&
    typeof service.openTab === 'function' &&
    typeof service.activateTab === 'function' &&
    typeof service.openFile === 'function'
  )
}

export interface BetterSidebarIntegrationOptions {
  readonly sessions: ISessions
  readonly wordWrap: ObservableSnapshot<boolean>
  readonly locale: { readonly subscribe: (listener: () => void) => () => void }
  readonly t: TranslateNS<typeof NS>
  readonly runtimeFor: (sessionId: string) => FileReviewTabRuntime
}

/** Install a child fiber that appears and disappears with the optional service. */
export function installBetterSidebarIntegration(
  ctx: ClientContext,
  { sessions, wordWrap, locale, t, runtimeFor }: BetterSidebarIntegrationOptions,
): void {
  let warned = false
  const warnOnce = (message: string, error?: unknown): void => {
    if (warned) return
    warned = true
    if (error === undefined) console.warn(`[dsh-file-review] ${message}`)
    else console.error(`[dsh-file-review] ${message}`, error)
  }

  const dynamicInject = (ctx as unknown as { inject?: ClientContext['inject'] }).inject
  if (typeof dynamicInject !== 'function') return

  dynamicInject.call(ctx, ['betterSidebar'], (sidebarCtx) => {
    const service = sidebarCtx.get('betterSidebar') as unknown
    if (!supportsReviewTab(service)) {
      warnOnce(
        `dsh-better-sidebar is missing required features: ${REQUIRED_FEATURES.join(', ')}; using the standalone drawer`,
      )
      return
    }

    sidebarCtx.effect(() => {
      let disposeTab: (() => void) | undefined
      let detachAdapter: (() => void) | undefined
      let unsubscribeLocale: (() => void) | undefined
      try {
        const descriptor: TabDescriptor = {
          id: REVIEW_TAB_ID,
          title: () => t('review.title'),
          icon: (size): ReactNode => <ReviewTabIcon size={size} />,
          order: 45,
          hidden: true,
          single: true,
          component: ({ scope, tab, visible }: TabComponentProps): ReactNode => {
            const runtime = runtimeFor(scope.sessionId)
            return (
              <FileReviewTab
                sessions={sessions}
                scope={scope}
                tab={tab}
                visible={visible}
                runtime={runtime}
                wordWrap={wordWrap}
                openFile={(path) => {
                  service.openFile(scope, path)
                }}
                t={t}
              />
            )
          },
        }
        disposeTab = service.registerTab(descriptor)
        // better-sidebar resolves descriptor.title only when a tab is created; keep the
        // persisted title in sync while this single Review tab remains open.
        unsubscribeLocale = locale.subscribe(() => {
          service.updateTab(REVIEW_TAB_ID, { title: t('review.title') })
        })

        const adapter: ReviewHostAdapter = {
          open(request) {
            if (!service.isTabEnabled(REVIEW_TAB_ID)) return false
            const scope: SidebarScope = {
              sessionId: request.sessionId,
              ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
            }
            const meta = {
              turn: request.target.turn,
              closingSeq: request.target.closingSeq,
              focusPaths: [...request.target.focusPaths],
            }
            const firstPath = request.target.focusPaths[0]
            try {
              service.updateTab(REVIEW_TAB_ID, {
                title: t('review.title'),
                ...(firstPath === undefined ? {} : { path: firstPath }),
                meta,
              })
              service.openTab(
                {
                  type: REVIEW_TAB_ID,
                  id: REVIEW_TAB_ID,
                  title: t('review.title'),
                  ...(firstPath === undefined ? {} : { path: firstPath }),
                  meta,
                },
                scope,
              )
              service.activateTab(REVIEW_TAB_ID, scope)
              return true
            } catch (error) {
              warnOnce(
                'could not open the better-sidebar review tab; using the standalone drawer',
                error,
              )
              return false
            }
          },
        }
        detachAdapter = attachReviewHost(adapter)
      } catch (error) {
        warnOnce(
          'could not register the better-sidebar review tab; using the standalone drawer',
          error,
        )
      }

      return () => {
        unsubscribeLocale?.()
        detachAdapter?.()
        disposeTab?.()
      }
    }, 'dsh-file-review: better-sidebar adapter')
  })
}
