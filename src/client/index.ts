/**
 * File-review plugin, browser half: registers the produced-files card into
 * the chat view's turn-tail chain, and provides the `chatFileMentions`
 * service that links inline-code mentions of produced files in the closing
 * prose. All policy lives here — the derivation from the mutation tools'
 * `locations`, the mention matching, the chip cap, and the copy — so
 * composing this plugin out of cordis.yml removes both surfaces entirely;
 * the owning view renders an empty chain and inert prose at zero cost.
 */
import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { FileReviewRequest, FileReviewResult } from '../change-types.ts'
import { TYPERT_REMOTE } from '../remote.ts'
import {
  DEFAULT_WORD_WRAP,
  FILE_REVIEW_SETTINGS_NAMESPACE,
  type Config,
} from '../settings-contract.ts'
import { ProducedFiles } from './ProducedFiles.tsx'
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
  'conversationEvents',
  'remote',
  'connection',
  'settingsScope',
  'sessions',
  'conversation',
  'inputTriggers',
]

interface FileReviewRemote {
  status(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
  apply(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
}

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
  const reviewBindings = new Map<string, ReturnType<typeof bindReviewReference>>()
  // The package ships Host and browser halves in one TypeScript program. The Host
  // SessionStore and browser ISessions intentionally share the Cordis key, so keep
  // this platform-specific narrowing at the browser entry boundary.
  const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
  const reviewBindingFor = (
    sessionId: SessionId,
  ): ReturnType<typeof bindReviewReference> | undefined => {
    let binding = reviewBindings.get(sessionId)
    if (binding !== undefined) return binding
    const scope = sessions.scope(sessionId)
    if (scope === undefined) return undefined
    binding = bindReviewReference(
      scope,
      sessionId,
      ctx.conversation.input.for(scope),
      ctx.locale.bind(NS),
    )
    reviewBindings.set(sessionId, binding)
    return binding
  }
  ctx.conversationEvents.register(deliverablesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'file-review: dictionaries')
  const settingsCell = {
    // rc.7 declares this slot keyed; rc.6 used a list id.
    key: FILE_REVIEW_SETTINGS_NAMESPACE,
    id: FILE_REVIEW_SETTINGS_NAMESPACE,
    order: 30,
  } as const
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        ...settingsCell,
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
          locale: 'conversation',
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
        locale: NS,
        inject: (sessionId) => {
          const projectRoot = sessions.list.getSnapshot().byId[sessionId]?.cwd
          const reviewBinding = reviewBindingFor(sessionId)
          const invoke = async (
            method: 'status' | 'apply',
            request: FileReviewRequest,
          ): Promise<FileReviewResult> => {
            const scope = sessions.scope(sessionId)
            if (scope === undefined) throw new Error('Session is unavailable')
            // Session scopes are minted by the client runtime and cannot statically
            // inject namespaces contributed later by feature plugins. `get()` is the
            // Cordis escape hatch for an explicitly mounted dynamic service; tracing
            // still binds the Remote call to this Session scope.
            const fileReview = scope.get('remote.fileReview') as FileReviewRemote | undefined
            if (fileReview === undefined) throw new Error('File review Remote is unavailable')
            const result = await fileReview[method](request)
            if (!result.ok) throw new Error(result.error.message)
            return result.value
          }
          return {
            projectRoot,
            sessionId,
            wordWrap,
            syncComments: reviewBinding?.sync,
            inspectChanges: (request: FileReviewRequest) => invoke('status', request),
            applyChanges: (request: FileReviewRequest) => invoke('apply', request),
          }
        },
      },
      ProducedFiles,
    ),
  )
  // The prose side of the same vocabulary: the chat view reaches this face
  // via ctx.get, so its absence — this plugin composed out — is the off state.
  const t = ctx.locale.bind(NS)
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
    disposeReviewSource()
    clearAllReviewComments()
    await disposeRemote()
  }
}
