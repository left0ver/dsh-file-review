import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import {
  SettingsProvider, settingsNamespace, type SettingsNamespace,
} from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply, Config, FILE_REVIEW_SETTINGS_NAMESPACE, inject,
} from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  private storedDocument: Record<string, unknown> = {}

  protected async load(): Promise<Record<string, unknown>> {
    return this.storedDocument
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.storedDocument = { ...this.storedDocument, [String(ns)]: section }
  }
}

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('file-review settings', () => {
  it('defaults visual line wrapping to false', () => {
    expect(Config({})).toEqual({ wordWrap: false })
  })

  it('registers a live settings section over the plugin entry config', async () => {
    ctx = new Context()
    let settings: MemorySettings | undefined
    await ctx.plugin({
      apply(scoped) { settings = new MemorySettings(scoped) },
    }).await()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    await ctx.plugin({ apply, inject }, { wordWrap: true }).await()

    const namespace = settingsNamespace(FILE_REVIEW_SETTINGS_NAMESPACE)
    expect(settings?.get(namespace)).toEqual({ wordWrap: true })
    await settings?.update(namespace, { wordWrap: false })
    expect(settings?.get(namespace)).toEqual({ wordWrap: false })
  })
})
