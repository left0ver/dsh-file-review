import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, Config, FILE_REVIEW_SETTINGS_NAMESPACE, inject } from '../src/index.ts'

let storedDocument: Record<string, unknown> = {}

class MemorySettings extends SettingsProvider {
  readonly writable = true

  protected async load(): Promise<Record<string, unknown>> {
    return storedDocument
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    storedDocument = { ...storedDocument, [String(ns)]: section }
  }
}

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  storedDocument = {}
})

describe('file-review settings', () => {
  // 验证默认双栏且关闭换行，并拒绝未知显示模式。
  it('defaults to split with wrapping off and validates the layout', () => {
    expect(Config({})).toEqual({ wordWrap: false, diffLayout: 'split' })
    expect(() => Config({ diffLayout: 'invalid' })).toThrow()
  })

  // 验证插件配置可初始化实时设置，且后续设置更新立即覆盖旧值。
  it('registers a live settings section over the plugin entry config', async () => {
    ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    let settings = ctx.settings
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    await ctx.plugin({ apply, inject }, { wordWrap: true }).await()

    expect(settings?.get(FILE_REVIEW_SETTINGS_NAMESPACE)).toEqual({
      wordWrap: true,
      diffLayout: 'split',
    })
    await settings?.update(FILE_REVIEW_SETTINGS_NAMESPACE, {
      wordWrap: false,
      diffLayout: 'unified',
    })
    expect(settings?.get(FILE_REVIEW_SETTINGS_NAMESPACE)).toEqual({
      wordWrap: false,
      diffLayout: 'unified',
    })

    // 模拟重新启动 Host：用户保存的单栏优先于插件默认双栏。
    await ctx.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    settings = ctx.settings
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    await ctx.plugin({ apply, inject }, {}).await()
    expect(settings?.get(FILE_REVIEW_SETTINGS_NAMESPACE)).toEqual({
      wordWrap: false,
      diffLayout: 'unified',
    })
  })
})
