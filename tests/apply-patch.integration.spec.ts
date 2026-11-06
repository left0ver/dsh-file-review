import { access, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import * as FileTools from '@deepseek-ai/dsh-tool-fs'
import { afterEach, describe, expect, it } from 'vitest'
import { FileReviewService } from '../src/file-review-service.ts'
import { markerFromContent } from '../src/ptc-marker.ts'
import { createHost, executeTool } from './host.ts'

let ctx: Context | undefined
let root: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function host() {
  await mkdir(resolve('.e2e'), { recursive: true })
  root = await mkdtemp(resolve('.e2e', 'apply-patch-integration-'))
  const result = await createHost(root)
  ctx = result.ctx
  return { ...result, root }
}

describe('安装配置中的 apply_patch', () => {
  it('连续执行 100 次创建、编辑、移动和删除，并逐次验证 diff、撤销和重新应用', async () => {
    const { ctx, agent, root } = await host()
    const service = ctx.get('fileReview') as FileReviewService | undefined
    if (service === undefined) throw new Error('文件审查服务没有启动')
    expect(ctx.tools.definitions(agent).filter((tool) => tool.name === 'apply_patch')).toHaveLength(
      1,
    )

    for (let iteration = 0; iteration < 25; iteration++) {
      const before = `中文内容 ${iteration}\n原始内容\n`
      const edited = `中文内容 ${iteration}\n修改内容\n`
      const moved = `中文内容 ${iteration}\n移动内容\n`
      const operations = [
        {
          input: `*** Add File: original.txt\n+中文内容 ${iteration}\n+原始内容`,
          expected: [{ path: 'original.txt', oldText: null, newText: before, kind: 'create' }],
        },
        {
          input: '*** Update File: original.txt\n@@\n-原始内容\n+修改内容',
          expected: [
            { path: 'original.txt', oldText: '原始内容\n', newText: '修改内容\n', kind: undefined },
          ],
        },
        {
          input: '*** Update File: original.txt\n*** Move to: moved.txt\n@@\n-修改内容\n+移动内容',
          expected: [
            { path: 'original.txt', oldText: edited, newText: '', kind: 'delete' },
            { path: 'moved.txt', oldText: null, newText: moved, kind: 'create' },
          ],
        },
        {
          input: '*** Delete File: moved.txt',
          expected: [{ path: 'moved.txt', oldText: moved, newText: '', kind: 'delete' }],
        },
      ]

      for (const operation of operations) {
        const { callId, result } = await executeTool(ctx, agent, 'apply_patch', {
          input: `*** Begin Patch\n${operation.input}\n*** End Patch`,
        })
        expect(result.isError).toBe(false)
        const marker = markerFromContent(result.content, { rootCallId: callId, subCallId: callId })
        if (marker === null) throw new Error('工具执行结果缺少文件变更记录')
        expect(marker.truncated).toBe(false)
        expect(
          marker.files.flatMap((file) =>
            file.diffs.map((diff) => ({
              path: file.path,
              oldText: diff.oldText,
              newText: diff.newText,
              kind: diff.lifecycle?.kind,
            })),
          ),
        ).toEqual(operation.expected)

        const files = marker.files.map(({ path, diffs }) => ({ path, diffs }))
        const undone = await service.apply(agent, { action: 'undo', files })
        expect(undone.files.every((file) => file.state === 'undone' && file.changed)).toBe(true)
        const redone = await service.apply(agent, { action: 'redo', files })
        expect(redone.files.every((file) => file.state === 'applied' && file.changed)).toBe(true)

        for (const file of marker.files) {
          const lifecycle = file.diffs[0]?.lifecycle
          if (lifecycle?.kind === 'delete') {
            await expect(access(join(root, file.path))).rejects.toMatchObject({ code: 'ENOENT' })
          } else if (lifecycle?.kind === 'create') {
            expect(await readFile(join(root, file.path), 'utf8')).toBe(file.diffs[0]?.newText)
            expect((await lstat(join(root, file.path))).mode & 0o777).toBe(lifecycle.mode)
          } else {
            expect(await readFile(join(root, file.path), 'utf8')).toBe(edited)
          }
        }
      }
    }
  })

  it('错误补丁返回失败，后续有效调用仍能生成完整 diff', async () => {
    const { ctx, agent, root } = await host()
    for (const input of [
      'invalid patch',
      '*** Begin Patch\n*** Update File: missing.txt\n@@\n-before\n+after\n*** End Patch',
    ]) {
      const { callId, result } = await executeTool(ctx, agent, 'apply_patch', { input })
      expect(result.isError).toBe(true)
      expect(
        markerFromContent(result.content, { rootCallId: callId, subCallId: callId }),
      ).toBeNull()
    }
    const { callId, result } = await executeTool(ctx, agent, 'apply_patch', {
      input: '*** Begin Patch\n*** Add File: valid.txt\n+valid\n*** End Patch',
    })
    expect(result.isError).toBe(false)
    expect(
      markerFromContent(result.content, { rootCallId: callId, subCallId: callId })?.files,
    ).toHaveLength(1)
    expect(await readFile(join(root, 'valid.txt'), 'utf8')).toBe('valid\n')
  })

  it('预设独立启用 apply_patch 时仅选择当前 Agent 可见的一份工具定义', async () => {
    const { ctx, agent } = await host()
    await agent.ctx
      .plugin(FileTools, {
        read: false,
        readImage: false,
        write: false,
        edit: false,
        applyPatch: true,
      })
      .await()
    expect(ctx.tools.definitions(agent).filter((tool) => tool.name === 'apply_patch')).toHaveLength(
      1,
    )
    const { result } = await executeTool(ctx, agent, 'apply_patch', {
      input: '*** Begin Patch\n*** Add File: scoped.txt\n+scoped\n*** End Patch',
    })
    expect(result.isError).toBe(false)
  })
})
