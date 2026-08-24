import { access, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import type { FileReviewRequest } from '../src/change-types.ts'
import { FileReviewService } from '../src/file-review-service.ts'
import { apply, inject } from '../src/index.ts'
import { markerFromContent } from '../src/ptc-marker.ts'

let ctx: Context | undefined
let root: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function smokeAgent(cwd: string, callId: string): Agent {
  return {
    session: {
      header: { cwd },
      events: [{
        seq: 1,
        time: 1,
        type: 'tool/call',
        data: { turn: 1, step: 1, callId, name: 'smoke_mutate', arguments: '{}' },
      }],
    },
    runMaintenance: async task => task(new AbortController().signal),
  } as unknown as Agent
}

describe('file review smoke', () => {
  it('captures, undoes, and reapplies created and deleted files end to end', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-file-review-smoke-'))
    const createdPath = join(root, 'created.txt')
    const deletedPath = join(root, 'deleted.txt')
    await writeFile(deletedPath, 'before deletion\n', { mode: 0o600 })

    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    await ctx.plugin({ apply, inject }).await()
    ctx.tools.register(defineTool({
      name: 'smoke_mutate',
      description: 'create one file and delete another',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      presentCall: () => ({
        card: 'diff',
        title: 'Smoke mutation',
        locations: [{ path: 'created.txt' }, { path: 'deleted.txt' }],
        diffs: [
          { path: 'created.txt', oldText: null, newText: 'created\n' },
          { path: 'deleted.txt', oldText: 'before deletion\n', newText: '' },
        ],
      }),
      async execute() {
        await writeFile(createdPath, 'created\n', { mode: 0o640 })
        await rm(deletedPath)
        return 'done'
      },
    }))

    const callId = 'smoke-call'
    const agent = smokeAgent(root, callId)
    const toolResult = await ctx.tools.execute({
      callId,
      name: 'smoke_mutate',
      arguments: {},
      agent,
      signal: new AbortController().signal,
    })
    const marker = markerFromContent(toolResult.content, {
      rootCallId: callId,
      subCallId: callId,
    })
    expect(marker).toEqual(expect.objectContaining({ schema: 2, truncated: false }))
    if (marker === null) throw new Error('lifecycle marker was not captured')
    expect(marker.files.map(file => [file.path, file.diffs[0]?.lifecycle?.kind])).toEqual([
      ['created.txt', 'create'],
      ['deleted.txt', 'delete'],
    ])

    const service = ctx.get('fileReview') as FileReviewService | undefined
    if (service === undefined) throw new Error('fileReview service was not registered')
    const request: FileReviewRequest = {
      action: 'undo',
      files: marker.files.map(file => ({ path: file.path, diffs: file.diffs })),
    }

    expect((await service.status(agent, request)).files.map(file => file.state))
      .toEqual(['applied', 'applied'])
    expect(await service.apply(agent, request)).toEqual({ files: [
      { path: 'created.txt', state: 'undone', changed: true },
      { path: 'deleted.txt', state: 'undone', changed: true },
    ] })
    await expect(access(createdPath)).rejects.toThrow()
    expect(await readFile(deletedPath, 'utf8')).toBe('before deletion\n')
    expect((await lstat(deletedPath)).mode & 0o777).toBe(0o600)

    expect(await service.apply(agent, { ...request, action: 'redo' })).toEqual({ files: [
      { path: 'created.txt', state: 'applied', changed: true },
      { path: 'deleted.txt', state: 'applied', changed: true },
    ] })
    expect(await readFile(createdPath, 'utf8')).toBe('created\n')
    expect((await lstat(createdPath)).mode & 0o777).toBe(0o640)
    await expect(access(deletedPath)).rejects.toThrow()
  })
})
