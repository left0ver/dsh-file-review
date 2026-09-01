/**
 * File-review plugin, browser half: registers the produced-files card into
 * the chat view's turn-tail chain, and provides the `chatFileMentions`
 * service that links inline-code mentions of produced files in the closing
 * prose. All policy lives here — the derivation from the mutation tools'
 * `locations`, the mention matching, the chip cap, and the copy — so
 * composing this plugin out of cordis.yml removes both surfaces entirely;
 * the owning view renders an empty chain and inert prose at zero cost.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FileReviewRequest, FileReviewResult } from '../change-types.ts'
import { TYPERT_REMOTE } from '../remote.ts'
import {
  DEFAULT_WORD_WRAP,
  FILE_REVIEW_SETTINGS_NAMESPACE,
  type Config,
} from '../settings-contract.ts'
import { ProducedFiles } from './ProducedFiles.tsx'
import { installBetterSidebarIntegration } from './better-sidebar-adapter.tsx'
import type { FileReviewTabRuntime } from './FileReviewTab.tsx'
import { FileReviewSettingsCard } from './FileReviewSettingsCard.tsx'
import { ReviewCommentsDock } from './ReviewCommentsDock.tsx'
import { ReviewUserMessage } from './ReviewUserMessage.tsx'
import { en, NS, zh, type DeliverablesKey } from './locales.ts'
import {
  deliverablesDefinition,
  producedFileMentions,
  selectProducedFiles,
} from './turn-deliverables.ts'
import { bindReviewReference, reviewCommentSource } from './review-reference.ts'
import { clearAllReviewComments } from './review-comments.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Produced-files row copy. */
    'file-review': DeliverablesKey
  }
}

/** Required services for the tail-slot registration and its dictionaries. */
export const inject = [
  'slots',
  'locale',
  'uiConversation',
  'remote',
  'connection',
  'settingsScope',
  'sessions',
  'conversation',
  'inputTriggers',
]

/**
 * Client plugin body: register the dictionaries and the turn-tail entry.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const disposeReviewSource = ctx.inputTriggers.registerSource(reviewCommentSource())
  const settings = ctx.settingsScope.bind<Config>({
    namespace: FILE_REVIEW_SETTINGS_NAMESPACE,
  })
  const wordWrap = {
    getSnapshot: () => settings.getSnapshot().value?.wordWrap ?? DEFAULT_WORD_WRAP,
    subscribe: (listener: () => void) => settings.subscribe(listener),
  }
  const t = ctx.locale.bind(NS)
  const reviewBindings = new Map<string, ReturnType<typeof bindReviewReference>>()
  const reviewRemotes = new Map<string, FileReviewTabRuntime>()
  // The package ships Host and browser halves in one TypeScript program. The Host
  // SessionStore and browser ISessions intentionally share the Cordis key, so keep
  // this platform-specific narrowing at the browser entry boundary.
  const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
  const reviewBindingFor = (
    sessionId: SessionId,
  ): ReturnType<typeof bindReviewReference> | undefined => {
    let binding = reviewBindings.get(sessionId)
    if (binding !== undefined) return binding
    const session = sessions.binding(sessionId)
    if (session === undefined) return undefined
    binding = bindReviewReference(
      session.ctx,
      sessionId,
      ctx.conversation.input.for(session.ctx),
      ctx.locale.bind(NS),
      session.eventSource,
    )
    reviewBindings.set(sessionId, binding)
    return binding
  }
  const reviewRemoteFor = (sessionId: SessionId): FileReviewTabRuntime => {
    let remote = reviewRemotes.get(sessionId)
    if (remote !== undefined) return remote
    const invoke = async (
      method: 'status' | 'apply',
      request: FileReviewRequest,
    ): Promise<FileReviewResult> => {
      const scope = sessions.scope(sessionId)
      if (scope === undefined) throw new Error('Session is unavailable')
      const fileReview = scope.get('remote.fileReview')
      if (fileReview === undefined) throw new Error('File review remote is unavailable')
      const result = await fileReview[method](request)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    remote = {
      inspectChanges: (request) => invoke('status', request),
      applyChanges: (request) => invoke('apply', request),
      // Creating a review binding subscribes to composer-reference state. Keep
      // that work out of the optional Tab component's render path and only do
      // it when comments actually need reconciliation.
      syncComments: () => {
        reviewBindingFor(sessionId)?.sync()
      },
    }
    reviewRemotes.set(sessionId, remote)
    return remote
  }
  const reviewRuntimeFor = (sessionId: string): FileReviewTabRuntime =>
    reviewRemoteFor(sessionId as SessionId)

  installBetterSidebarIntegration(ctx, {
    sessions,
    uiConversation: ctx.uiConversation,
    wordWrap,
    locale: ctx.locale,
    t,
    runtimeFor: reviewRuntimeFor,
  })
  ctx.uiConversation.events.register(deliverablesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'file-review: dictionaries')
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: FILE_REVIEW_SETTINGS_NAMESPACE,
        locale: NS,
        inject: () => ({
          hooks: { fileReviewSettings: settings },
          setWordWrap: (value: boolean) => settings.set('wordWrap', value),
        }),
      },
      FileReviewSettingsCard,
    ),
  )
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'file-review-comments',
        order: -10,
        locale: NS,
        inject: (sessionId) => ({
          projectRoot: sessions.list.getSnapshot().byId[sessionId]?.cwd,
        }),
      },
      ReviewCommentsDock,
    ),
  )
  for (const key of ['user', 'steering'] as const) {
    ctx.slots.inject('conversation.chat.node', () =>
      ctx.slots.register(
        {
          name: 'conversation.chat.node',
          key,
          priority: -10,
          locale: 'chat',
          inject: () => ({ reviewT: ctx.locale.bind(NS) }),
        },
        ReviewUserMessage,
      ),
    )
  }
  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.turnTail',
        select: selectProducedFiles,
        priority: -2,
        registrant: 'dsh-file-review',
        locale: NS,
        inject: (sessionId) => {
          const projectRoot = sessions.list.getSnapshot().byId[sessionId]?.cwd
          const reviewBinding = reviewBindingFor(sessionId)
          const remote = reviewRemoteFor(sessionId)
          return {
            projectRoot,
            sessionId,
            wordWrap,
            ...remote,
            syncComments: reviewBinding?.sync,
          }
        },
      },
      ProducedFiles,
    ),
  )
  // The prose side of the same vocabulary: the chat view reaches this face
  // via ctx.get, so its absence — this plugin composed out — is the off state.
  const mentions: ChatFileMentions = {
    forClosing(owner) {
      // Same claim test the turn-tail chain entry runs: no produced files,
      // no vocabulary — the two surfaces agree by construction.
      const reviews = selectProducedFiles(owner)
      if (reviews === null) return undefined
      return producedFileMentions(
        reviews.map((review) => review.path),
        owner.openFile,
        (path) => t('produced.open', { name: path }),
      )
    },
  }
  ctx.provide('chatFileMentions', mentions)
  return async () => {
    for (const binding of reviewBindings.values()) binding.dispose()
    reviewBindings.clear()
    reviewRemotes.clear()
    disposeReviewSource()
    clearAllReviewComments()
    await disposeRemote()
  }
}
