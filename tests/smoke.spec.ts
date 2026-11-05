import { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { FileReviewRequest } from '../src/change-types.ts'
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

describe('file review smoke', () => {
  // 验证从工具执行捕获到文件服务的完整链路：创建和删除标记可用于撤销及重新应用，并恢复正确内容和权限。
  it('captures, undoes, and reapplies created and deleted files end to end', async () => {
    await mkdir(resolve('.e2e'), { recursive: true })
    root = await mkdtemp(resolve('.e2e', 'dsh-file-review-smoke-'))
    const createdPath = join(root, 'created.txt')
    const deletedPath = join(root, 'deleted.txt')
    await writeFile(deletedPath, 'before deletion\n', { mode: 0o600 })

    const host = await createHost(root)
    ctx = host.ctx
    const agent = host.agent
    const { callId, result: toolResult } = await executeTool(ctx, agent, 'apply_patch', {
      input:
        '*** Begin Patch\n*** Add File: created.txt\n+created\n*** Delete File: deleted.txt\n*** End Patch',
    })
    expect(toolResult.isError).toBe(false)
    const createdMode = (await lstat(createdPath)).mode & 0o777
    const marker = markerFromContent(toolResult.content, {
      rootCallId: callId,
      subCallId: callId,
    })
    expect(marker).toEqual(expect.objectContaining({ schema: 2, truncated: false }))
    if (marker === null) throw new Error('lifecycle marker was not captured')
    const files = [...marker.files].sort((a, b) => a.path.localeCompare(b.path))
    expect(files.map((file) => [file.path, file.diffs[0]?.lifecycle?.kind])).toEqual([
      ['created.txt', 'create'],
      ['deleted.txt', 'delete'],
    ])

    const service = ctx.get('fileReview') as FileReviewService | undefined
    if (service === undefined) throw new Error('fileReview service was not registered')
    const request: FileReviewRequest = {
      action: 'undo',
      files: files.map((file) => ({ path: file.path, diffs: file.diffs })),
    }

    expect((await service.status(agent, request)).files.map((file) => file.state)).toEqual([
      'applied',
      'applied',
    ])
    expect(await service.apply(agent, request)).toEqual({
      files: [
        { path: 'created.txt', state: 'undone', changed: true },
        { path: 'deleted.txt', state: 'undone', changed: true },
      ],
    })
    await expect(access(createdPath)).rejects.toThrow()
    expect(await readFile(deletedPath, 'utf8')).toBe('before deletion\n')
    expect((await lstat(deletedPath)).mode & 0o777).toBe(0o600)

    expect(await service.apply(agent, { ...request, action: 'redo' })).toEqual({
      files: [
        { path: 'created.txt', state: 'applied', changed: true },
        { path: 'deleted.txt', state: 'applied', changed: true },
      ],
    })
    expect(await readFile(createdPath, 'utf8')).toBe('created\n')
    expect((await lstat(createdPath)).mode & 0o777).toBe(createdMode)
    await expect(access(deletedPath)).rejects.toThrow()
  })
})
