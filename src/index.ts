/**
 * File-review plugin, node half. Registers the response-format guidance that
 * lets the browser half recognize final-response file references. The browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration.
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { FileReviewService } from './file-review-service.ts'
import { registerFileLifecycleCapture } from './file-lifecycle-capture.ts'
import { registerPtcAdapter } from './ptc-adapter.ts'
import { DEFAULT_WORD_WRAP, DEFAULT_DIFF_LAYOUT, type DiffLayout } from './settings-contract.ts'

export type * from './change-types.ts'
export { FileReviewService, transformFile } from './file-review-service.ts'
export { DEFAULT_WORD_WRAP, FILE_REVIEW_SETTINGS_NAMESPACE } from './settings-contract.ts'

export interface Config {
  wordWrap: Volatile<boolean>
  diffLayout: Volatile<DiffLayout>
}

/** 可由当前 Profile 即时更新的显示设置。 */
export const Config = z.object({
  wordWrap: z.boolean().default(DEFAULT_WORD_WRAP).volatile(),
  diffLayout: z
    .union([z.const('split'), z.const('unified')])
    .default(DEFAULT_DIFF_LAYOUT)
    .volatile(),
})

/** Services required for the model guidance paired with the browser renderer. */
export const inject = ['systemPrompt', 'tools']

/** Stable final-response guidance owned by the matching renderer. */
const FILE_REFERENCE_PROMPT =
  'When you successfully create or modify files, mention the primary outputs in your final response. ' +
  'To make those and any other changed-file references clickable in Web, format them as Markdown inline code using the exact file-tool path, or a basename when unique among the files changed in that turn.'

/**
 * Register model guidance for the file-reference renderer shipped by this package.
 * @param ctx - host context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  new FileReviewService(ctx)
  registerFileLifecycleCapture(ctx)
  registerPtcAdapter(ctx)
  ctx.systemPrompt.section({
    name: 'ui:file-review-references',
    order: 190,
    text: FILE_REFERENCE_PROMPT,
  })
}
