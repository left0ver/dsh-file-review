/** Register file review directly in DSH's native right sidebar. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { FileReviewTab, type FileReviewTabRuntime, type ReviewTarget } from './FileReviewTab.tsx'
import { NS } from './locales.ts'

const REVIEW_TAB_ID = 'dsh-file-review:review'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'dsh-file-review:review': ReviewTarget
  }
}

interface NativeSidebarIntegrationOptions {
  readonly sessions: ISessions
  readonly uiConversation: UiConversation
  readonly wordWrap: ObservableSnapshot<boolean>
  readonly t: TranslateNS<typeof NS>
  readonly runtimeFor: (sessionId: SessionId) => FileReviewTabRuntime
}

function ReviewTabTitle({ t }: PropsLocale<typeof NS>) {
  return <>{t('review.title')}</>
}

/** Register the native tab and return its session-targeted opener. */
export function installNativeSidebarIntegration(
  ctx: ClientContext,
  { sessions, uiConversation, wordWrap, t, runtimeFor }: NativeSidebarIntegrationOptions,
): (sessionId: SessionId, target: ReviewTarget) => void {
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: REVIEW_TAB_ID,
        kind: REVIEW_TAB_ID,
        title: () => t('review.title'),
      }),
    'dsh-file-review: native review tab',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: REVIEW_TAB_ID, locale: NS },
          function ReviewTab({
            useTabInfo,
            useSessions,
            sessionId,
            t,
          }: PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<typeof NS>) {
            const { tab } = useTabInfo()
            const cwd = useSessions((state) => state.byId[sessionId]?.cwd)
            return (
              <FileReviewTab
                sessions={sessions}
                uiConversation={uiConversation}
                sessionId={sessionId}
                projectRoot={cwd}
                params={tab.navigation.params}
                visible={tab.visible}
                syncComments={runtimeFor(sessionId).syncComments}
                wordWrap={wordWrap}
                openFile={(path) => tab.actions.openResource(fileAddressFor(sessionId, cwd, path))}
                t={t}
              />
            )
          },
        ),
      ),
    'dsh-file-review: native review body',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab.title', key: REVIEW_TAB_ID, locale: NS },
          ReviewTabTitle,
        ),
      ),
    'dsh-file-review: native review title',
  )
  return (sessionId, target) => {
    ctx.sidebarRight.openTabIn(sessionId, REVIEW_TAB_ID, { params: target })
  }
}
