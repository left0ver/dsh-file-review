// @vitest-environment jsdom
import { pathToFileURL } from 'node:url'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { describe, expect, it } from 'vitest'

interface ClientHandoff {
  readonly id: string
  readonly factory: (require: (id: string) => unknown) => unknown
}

describe('published browser artifact', () => {
  it('registers through the Harness module loader and materializes without repository modules', async () => {
    let handoff: ClientHandoff | undefined
    const browserWindow = window as unknown as {
      __ModuleLoader__?: { load(value: ClientHandoff): void }
    }
    browserWindow.__ModuleLoader__ = { load: (value) => { handoff = value } }
    const artifact = pathToFileURL(new URL('../lib/client.js', import.meta.url).pathname)
    await import(/* @vite-ignore */ `${artifact.href}?test=${String(Date.now())}`)

    expect(handoff?.id).toBe('dsh-file-review')
    const shared: Record<string, unknown> = {
      react: React,
      'react/jsx-runtime': jsxRuntime,
    }
    const client = handoff?.factory((id) => {
      if (!(id in shared)) throw new Error(`unexpected shared module: ${id}`)
      return shared[id]
    }) as { apply?: unknown; inject?: unknown } | undefined
    expect(client?.apply).toBeTypeOf('function')
    expect(client?.inject).toEqual([
      'slots', 'locale', 'conversationEvents', 'remote', 'connection', 'settingsScope',
      'sessions', 'conversation', 'inputTriggers',
    ])
    expect(document.querySelectorAll('style[data-plugin="dsh-file-review"]')).toHaveLength(3)
  })
})
