/** Host Adapter: project nested PTC tool presentations into their durable log copy. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { PtcDispatchLog, ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import {
  boundedPtcFileReviewMarker,
  markerBlock,
  markerFromContent,
  normalizeMutationPresentation,
} from './ptc-marker.ts'

interface DispatchStart {
  readonly arguments: unknown
  readonly rootCallId: string
  readonly subCallId: string
}

interface RootCall {
  readonly turn: number
  readonly step: number
}

function dispatchStart(
  events: readonly SessionEvent[],
  dispatch: PtcDispatchLog,
): DispatchStart | null {
  const rootCallId = dispatch.exec.rootCallId
  const subCallId = dispatch.subCallId
  if (
    typeof rootCallId !== 'string' ||
    rootCallId === '' ||
    typeof subCallId !== 'string' ||
    subCallId === ''
  )
    return null
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (
      event?.type !== 'tool/code-dispatch-start' ||
      event.data.subCallId !== subCallId ||
      event.data.rootCallId !== rootCallId ||
      event.data.name !== dispatch.name
    )
      continue
    return { arguments: event.data.arguments, rootCallId, subCallId }
  }
  return null
}

function rootCall(events: readonly SessionEvent[], rootCallId: string): RootCall | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (
      event?.type !== 'tool/call' ||
      event.data.callId !== rootCallId ||
      !Number.isInteger(event.data.turn) ||
      event.data.turn < 0 ||
      !Number.isInteger(event.data.step) ||
      event.data.step < 0
    )
      continue
    return { turn: event.data.turn, step: event.data.step }
  }
  return null
}

type Presentation<T> =
  | { readonly kind: 'ok'; readonly view: T | undefined }
  | { readonly kind: 'error' }

function present<T>(run: () => T | undefined): Presentation<T> {
  try {
    return { kind: 'ok', view: run() }
  } catch {
    return { kind: 'error' }
  }
}

function sanitizeLoggedContent(content: ContentBlock[]): ContentBlock[] {
  let sanitized: ContentBlock[] | undefined
  for (let index = 0; index < content.length; index++) {
    const block = content[index]
    if (
      typeof block !== 'object' ||
      block === null ||
      !Object.prototype.hasOwnProperty.call(block, 'dshFileReview')
    )
      continue
    const copy = { ...block } as Record<string, unknown>
    delete copy.dshFileReview
    sanitized ??= [...content]
    sanitized[index] = copy as unknown as ContentBlock
  }
  return sanitized ?? content
}

/**
 * Await the existing log shapers, then append this plugin's invisible marker.
 * Any Adapter failure degrades to the already-shaped content.
 */
export async function adaptPtcDispatchLog(
  ctx: Context,
  dispatch: PtcDispatchLog,
  next: () => Promise<ContentBlock[]>,
): Promise<ContentBlock[]> {
  const loggedContent = sanitizeLoggedContent(await next())
  if (dispatch.isError || dispatch.agent === undefined) return loggedContent
  try {
    const events = dispatch.agent.session.events
    const start = dispatchStart(events, dispatch)
    if (start === null) return loggedContent
    const root = rootCall(events, start.rootCallId)
    if (root === null) return loggedContent
    const captured = markerFromContent(dispatch.content, {
      rootCallId: start.rootCallId,
      subCallId: start.subCallId,
    })
    const definition = ctx.tools.get(dispatch.name, dispatch.agent)
    if (definition === undefined) return loggedContent
    const call =
      definition.presentCall === undefined
        ? ({ kind: 'ok', view: undefined } as const)
        : present<ToolCallView>(() => definition.presentCall?.(start.arguments))
    if (call.kind === 'error') return loggedContent
    const result =
      definition.presentResult === undefined
        ? ({ kind: 'ok', view: undefined } as const)
        : present<ToolResultView>(() =>
            definition.presentResult?.(start.arguments, {
              content: dispatch.content,
              isError: false,
            }),
          )
    if (result.kind === 'error') return loggedContent
    const files =
      captured !== null && captured.turn === root.turn && captured.step === root.step
        ? captured.files
        : normalizeMutationPresentation(call.view, result.view)
    if (files.length === 0) return loggedContent
    const marker = boundedPtcFileReviewMarker({
      turn: root.turn,
      step: root.step,
      rootCallId: start.rootCallId,
      subCallId: start.subCallId,
      files,
    })
    return marker === null
      ? loggedContent
      : [...loggedContent, markerBlock(marker) as unknown as ContentBlock]
  } catch {
    return loggedContent
  }
}

/** Register the Adapter on the awaited PTC log-copy seam. */
export function registerPtcAdapter(ctx: Context): () => boolean {
  return ctx.on('tools/ptc-dispatch-log', (dispatch, next) =>
    adaptPtcDispatchLog(ctx, dispatch, next),
  )
}
