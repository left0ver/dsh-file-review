/** Host Adapter: project nested PTC tool presentations into their durable log copy. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { CodeDispatchLog, ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import {
  boundedPtcFileReviewMarker, markerBlock, normalizeMutationPresentation,
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

function dispatchStart(events: readonly SessionEvent[], dispatch: CodeDispatchLog): DispatchStart | null {
  const rootCallId = String(dispatch.exec.rootCallId)
  const subCallId = String(dispatch.subCallId)
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'tool/code-dispatch-start'
      || String(event.data.subCallId) !== subCallId
      || String(event.data.rootCallId) !== rootCallId
      || event.data.name !== dispatch.name) continue
    return { arguments: event.data.arguments, rootCallId, subCallId }
  }
  return null
}

function rootCall(events: readonly SessionEvent[], rootCallId: string): RootCall | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'tool/call' || String(event.data.callId) !== rootCallId) continue
    return { turn: event.data.turn, step: event.data.step }
  }
  return null
}

function presentCall(run: () => ToolCallView | undefined): ToolCallView | undefined {
  try {
    return run()
  } catch {
    return undefined
  }
}

function presentResult(run: () => ToolResultView | undefined): ToolResultView | undefined {
  try {
    return run()
  } catch {
    return undefined
  }
}

/**
 * Await the existing log shapers, then append this plugin's invisible marker.
 * Any Adapter failure degrades to the already-shaped content.
 */
export async function adaptPtcDispatchLog(
  ctx: Context,
  dispatch: CodeDispatchLog,
  next: () => Promise<ContentBlock[]>,
): Promise<ContentBlock[]> {
  const loggedContent = await next()
  if (dispatch.isError || dispatch.agent === undefined) return loggedContent
  try {
    const events = dispatch.agent.session.events
    const start = dispatchStart(events, dispatch)
    if (start === null) return loggedContent
    const root = rootCall(events, start.rootCallId)
    if (root === null) return loggedContent
    const definition = ctx.tools.get(dispatch.name, dispatch.agent)
    if (definition === undefined) return loggedContent
    const callView = definition.presentCall === undefined
      ? undefined
      : presentCall(() => definition.presentCall?.(start.arguments))
    const resultView = definition.presentResult === undefined
      ? undefined
      : presentResult(() => definition.presentResult?.(start.arguments, {
        content: dispatch.content,
        isError: false,
      }))
    const files = normalizeMutationPresentation(callView, resultView)
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

/** Register the Adapter on the awaited Code Mode log-copy seam. */
export function registerPtcAdapter(ctx: Context): () => boolean {
  return ctx.on('tools/code-dispatch-log', (dispatch, next) =>
    adaptPtcDispatchLog(ctx, dispatch, next))
}
