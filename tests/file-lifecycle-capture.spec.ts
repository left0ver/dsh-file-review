import { access, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { markerFromContent } from '../src/ptc-marker.ts'
import { createHost, executeTool } from './host.ts'

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

describe('工具文件变更记录', () => {
  it('记录原生 write 工具创建文件的内容和权限', async () => {
    const root = await workspace()
    const host = await createHost(root)
    ctx = host.ctx
    const { callId, result } = await executeTool(ctx, host.agent, 'write', {
      file_path: 'created.txt',
      content: 'created',
    })
    expect(result.isError).toBe(false)
    const mode = (await lstat(join(root, 'created.txt'))).mode & 0o777
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
            lifecycle: { kind: 'create', mode },
          },
        ],
      },
    ])
    expect(await readFile(join(root, 'created.txt'), 'utf8')).toBe('created')
  })

  it('记录 apply_patch 删除文件之前的内容和权限', async () => {
    const root = await workspace()
    await writeFile(join(root, 'deleted.txt'), 'deleted', { mode: 0o600 })
    const host = await createHost(root)
    ctx = host.ctx
    const { callId, result } = await executeTool(ctx, host.agent, 'apply_patch', {
      input: '*** Begin Patch\n*** Delete File: deleted.txt\n*** End Patch',
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
    await expect(access(join(root, 'deleted.txt'))).rejects.toThrow()
  })

  it('记录准确的插入和删除行号，并在差异块之间保留最多五行未修改内容', async () => {
    const root = await workspace()
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
    await writeFile(join(root, 'edited.txt'), before)
    const host = await createHost(root)
    ctx = host.ctx
    const { callId, result } = await executeTool(ctx, host.agent, 'write', {
      file_path: 'edited.txt',
      content: after,
    })
    expect(result.isError).toBe(false)
    expect(
      markerFromContent(result.content, { rootCallId: callId, subCallId: callId })?.files,
    ).toEqual([
      {
        path: 'edited.txt',
        source: 'result',
        diffs: [
          { path: 'edited.txt', oldText: '', newText: 'inserted\n', oldStart: 1, newStart: 1 },
          {
            path: 'edited.txt',
            oldText: 'repeat\nfive-1\nfive-2\nfive-3\nfive-4\nfive-5\nsecond-old\n',
            newText: 'changed\nfive-1\nfive-2\nfive-3\nfive-4\nfive-5\nsecond-new\n',
            oldStart: 8,
            newStart: 9,
          },
          { path: 'edited.txt', oldText: 'distant-old\n', newText: '', oldStart: 21, newStart: 22 },
        ],
      },
    ])
    expect(await readFile(join(root, 'edited.txt'), 'utf8')).toBe(after)
  })

  it('合并原生 edit 工具调用中的相对路径和执行结果中的绝对路径', async () => {
    const root = await workspace()
    await writeFile(join(root, 'edited.txt'), 'alpha\nbefore\nomega\n')
    const host = await createHost(root)
    ctx = host.ctx
    const { callId, result } = await executeTool(ctx, host.agent, 'edit', {
      file_path: 'edited.txt',
      old_string: 'before',
      new_string: 'after',
    })
    expect(result.isError).toBe(false)
    expect(
      markerFromContent(result.content, { rootCallId: callId, subCallId: callId })?.files,
    ).toEqual([
      {
        path: 'edited.txt',
        source: 'result',
        diffs: [
          { path: 'edited.txt', oldText: 'before\n', newText: 'after\n', oldStart: 2, newStart: 2 },
        ],
      },
    ])
  })

  it('记录单次 apply_patch 中的创建、删除、修改以及移动前后的路径', async () => {
    const root = await workspace()
    await writeFile(join(root, 'edited.txt'), 'old\n')
    await writeFile(join(root, 'deleted.txt'), 'deleted\n', { mode: 0o600 })
    await writeFile(join(root, 'source.txt'), 'before move\n', { mode: 0o640 })
    const host = await createHost(root)
    ctx = host.ctx
    const { callId, result } = await executeTool(ctx, host.agent, 'apply_patch', {
      input: [
        '*** Begin Patch',
        '*** Add File: created.txt',
        '+created',
        '*** Update File: edited.txt',
        '@@',
        '-old',
        '+new',
        '*** Delete File: deleted.txt',
        '*** Update File: source.txt',
        '*** Move to: destination.txt',
        '@@',
        '-before move',
        '+after move',
        '*** End Patch',
      ].join('\n'),
    })
    expect(result.isError).toBe(false)
    const files = markerFromContent(result.content, {
      rootCallId: callId,
      subCallId: callId,
    })?.files
    expect(files).toHaveLength(5)
    expect(files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'created.txt',
          diffs: [
            expect.objectContaining({
              oldText: null,
              newText: 'created\n',
              lifecycle: {
                kind: 'create',
                mode: (await lstat(join(root, 'created.txt'))).mode & 0o777,
              },
            }),
          ],
        }),
        expect.objectContaining({
          path: 'edited.txt',
          diffs: [
            { path: 'edited.txt', oldText: 'old\n', newText: 'new\n', oldStart: 1, newStart: 1 },
          ],
        }),
        expect.objectContaining({
          path: 'deleted.txt',
          diffs: [
            expect.objectContaining({
              oldText: 'deleted\n',
              lifecycle: { kind: 'delete', mode: 0o600 },
            }),
          ],
        }),
        expect.objectContaining({
          path: 'source.txt',
          diffs: [
            expect.objectContaining({
              oldText: 'before move\n',
              lifecycle: { kind: 'delete', mode: 0o640 },
            }),
          ],
        }),
        expect.objectContaining({
          path: 'destination.txt',
          diffs: [
            expect.objectContaining({
              oldText: null,
              newText: 'after move\n',
              lifecycle: {
                kind: 'create',
                mode: (await lstat(join(root, 'destination.txt'))).mode & 0o777,
              },
            }),
          ],
        }),
      ]),
    )
    expect(await readFile(join(root, 'created.txt'), 'utf8')).toBe('created\n')
    expect(await readFile(join(root, 'edited.txt'), 'utf8')).toBe('new\n')
    expect(await readFile(join(root, 'destination.txt'), 'utf8')).toBe('after move\n')
    await expect(access(join(root, 'deleted.txt'))).rejects.toThrow()
    await expect(access(join(root, 'source.txt'))).rejects.toThrow()
  })
})
