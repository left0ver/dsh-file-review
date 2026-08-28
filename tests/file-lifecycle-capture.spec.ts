import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'
import { markerFromContent } from '../src/ptc-marker.ts'

let ctx: Context | undefined
const roots: string[] = []

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-review-capture-'))
  roots.push(root)
  return root
}

function agent(cwd: string, callId: string, step = 1): Agent {
  return {
    session: {
      header: { cwd },
      events: [
        {
          seq: 0,
          time: 0,
          type: 'tool/call',
          data: { turn: 4, step, callId, name: 'fixture_write', arguments: '{}' },
        },
      ],
    },
  } as unknown as Agent
}

describe('tool lifecycle capture', () => {
  it('persists an explicit create diff from the execution before/after state', async () => {
    const root = await workspace()
    const filename = join(root, 'created.txt')
    const callId = 'create-call'
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()
    ctx.tools.register(
      defineTool({
        name: 'fixture_write',
        description: 'write a fixture file',
        parameters: {
          path: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: (args) => ({
          card: 'diff',
          title: `Write ${args.path}`,
          locations: [{ path: args.path }],
          diffs: [{ path: args.path, oldText: null, newText: args.content }],
        }),
        async execute(args) {
          await writeFile(join(root, args.path), args.content, { mode: 0o640 })
          return args.path
        },
      }),
    )

    const result = await ctx.tools.execute({
      callId,
      name: 'fixture_write',
      arguments: { path: 'created.txt', content: 'created' },
      agent: agent(root, callId),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(
      markerFromContent(result.content, { rootCallId: callId, subCallId: callId })?.files,
    ).toEqual([
      {
        path: 'created.txt',
        source: 'result',
        diffs: [
          {
            path: 'created.txt',
            oldText: null,
            newText: 'created',
            oldStart: 1,
            newStart: 1,
            lifecycle: { kind: 'create', mode: 0o640 },
          },
        ],
      },
    ])
    expect(await readFile(filename, 'utf8')).toBe('created')
  })

  it('persists the deleted file contents and permissions for a generic delete tool', async () => {
    const root = await workspace()
    const filename = join(root, 'deleted.txt')
    await writeFile(filename, 'deleted', { mode: 0o600 })
    const callId = 'delete-call'
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()
    ctx.tools.register(
      defineTool({
        name: 'fixture_delete',
        description: 'delete a fixture file',
        parameters: { path: { type: 'string', required: true } },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: (args) => ({
          card: 'generic',
          title: `Delete ${args.path}`,
          kind: 'delete',
          locations: [{ path: args.path }],
        }),
        async execute(args) {
          await rm(join(root, args.path))
          return args.path
        },
      }),
    )

    const result = await ctx.tools.execute({
      callId,
      name: 'fixture_delete',
      arguments: { path: 'deleted.txt' },
      agent: agent(root, callId),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(
      markerFromContent(result.content, { rootCallId: callId, subCallId: callId })?.files,
    ).toEqual([
      {
        path: 'deleted.txt',
        source: 'result',
        diffs: [
          {
            path: 'deleted.txt',
            oldText: 'deleted',
            newText: '',
            oldStart: 1,
            newStart: 1,
            lifecycle: { kind: 'delete', mode: 0o600 },
          },
        ],
      },
    ])
  })

  it('captures insert/delete coordinates and keeps at most five unchanged lines inline', async () => {
    const root = await workspace()
    const filename = join(root, 'edited.txt')
    const before =
      [
        'repeat',
        'lead-1',
        'lead-2',
        'lead-3',
        'lead-4',
        'lead-5',
        'lead-6',
        'repeat',
        'five-1',
        'five-2',
        'five-3',
        'five-4',
        'five-5',
        'second-old',
        'six-1',
        'six-2',
        'six-3',
        'six-4',
        'six-5',
        'six-6',
        'distant-old',
        'tail',
      ].join('\n') + '\n'
    const after =
      [
        'inserted',
        'repeat',
        'lead-1',
        'lead-2',
        'lead-3',
        'lead-4',
        'lead-5',
        'lead-6',
        'changed',
        'five-1',
        'five-2',
        'five-3',
        'five-4',
        'five-5',
        'second-new',
        'six-1',
        'six-2',
        'six-3',
        'six-4',
        'six-5',
        'six-6',
        'tail',
      ].join('\n') + '\n'
    await writeFile(filename, before)
    const callId = 'edit-call'
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()
    ctx.tools.register(
      defineTool({
        name: 'fixture_edit',
        description: 'edit a fixture file',
        parameters: { path: { type: 'string', required: true } },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: (args) => ({
          card: 'diff',
          title: `Edit ${args.path}`,
          locations: [{ path: args.path }],
          diffs: [{ path: args.path, oldText: 'repeat', newText: 'changed' }],
        }),
        presentResult: (args) => ({
          card: 'diff',
          diffs: [{ path: args.path, oldText: 'repeat', newText: 'changed' }],
        }),
        async execute(args) {
          await writeFile(join(root, args.path), after)
          return args.path
        },
      }),
    )

    const result = await ctx.tools.execute({
      callId,
      name: 'fixture_edit',
      arguments: { path: 'edited.txt' },
      agent: agent(root, callId),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(
      markerFromContent(result.content, { rootCallId: callId, subCallId: callId })?.files,
    ).toEqual([
      {
        path: 'edited.txt',
        source: 'result',
        diffs: [
          {
            path: 'edited.txt',
            oldText: '',
            newText: 'inserted\n',
            oldStart: 1,
            newStart: 1,
          },
          {
            path: 'edited.txt',
            oldText: 'repeat\nfive-1\nfive-2\nfive-3\nfive-4\nfive-5\nsecond-old\n',
            newText: 'changed\nfive-1\nfive-2\nfive-3\nfive-4\nfive-5\nsecond-new\n',
            oldStart: 8,
            newStart: 9,
          },
          {
            path: 'edited.txt',
            oldText: 'distant-old\n',
            newText: '',
            oldStart: 21,
            newStart: 22,
          },
        ],
      },
    ])
  })

  it('keeps ordinary edit diffs beside captured lifecycle diffs from the same call', async () => {
    const root = await workspace()
    await writeFile(join(root, 'edited.txt'), 'old')
    const callId = 'mixed-call'
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()
    ctx.tools.register(
      defineTool({
        name: 'fixture_mixed',
        description: 'create one file and edit another',
        parameters: {},
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: () => ({
          card: 'diff',
          title: 'Mixed write',
          locations: [{ path: 'created.txt' }, { path: 'edited.txt' }],
          diffs: [
            { path: 'created.txt', oldText: null, newText: 'created' },
            { path: 'edited.txt', oldText: 'old', newText: 'new' },
          ],
        }),
        presentResult: () => ({
          card: 'diff',
          diffs: [
            { path: 'created.txt', oldText: null, newText: 'created' },
            { path: 'edited.txt', oldText: 'old', newText: 'new' },
          ],
        }),
        async execute() {
          await writeFile(join(root, 'created.txt'), 'created', { mode: 0o640 })
          await writeFile(join(root, 'edited.txt'), 'new')
          return 'done'
        },
      }),
    )

    const result = await ctx.tools.execute({
      callId,
      name: 'fixture_mixed',
      arguments: {},
      agent: agent(root, callId),
      signal: new AbortController().signal,
    })
    const files = markerFromContent(result.content, {
      rootCallId: callId,
      subCallId: callId,
    })?.files

    expect(files).toEqual([
      {
        path: 'created.txt',
        source: 'result',
        diffs: [
          {
            path: 'created.txt',
            oldText: null,
            newText: 'created',
            oldStart: 1,
            newStart: 1,
            lifecycle: { kind: 'create', mode: 0o640 },
          },
        ],
      },
      {
        path: 'edited.txt',
        source: 'result',
        diffs: [
          {
            path: 'edited.txt',
            oldText: 'old',
            newText: 'new',
            oldStart: 1,
            newStart: 1,
          },
        ],
      },
    ])
  })
})
