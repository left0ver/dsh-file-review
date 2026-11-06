import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import Agents, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import Llm, { ToolCallId } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as FileTools from '@deepseek-ai/dsh-tool-fs'
import Tools from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import * as FileReview from '../src/index.ts'

/** 使用实际的 Session、Agent 和文件工具执行测试。 */
export async function createHost(cwd: string): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(Sessions).await()
  await ctx.plugin(SessionProjections).await()
  await ctx.plugin(Agents).await()
  await ctx.plugin(Llm).await()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(Tools).await()
  await ctx.plugin(NativeExecutor).await()
  await ctx.plugin(AgentLoop).await()
  await ctx.plugin(LocalFileSystem, { cwd }).await()
  await ctx.plugin(WorkingDirectory).await()
  await ctx.plugin(FileTools).await()
  const bundle = z
    .array(
      z.object({
        insert: z
          .array(z.object({ id: z.string(), name: z.string(), config: z.unknown().optional() }))
          .optional(),
      }),
    )
    .parse(load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')))
  const patchTool = bundle
    .flatMap((entry) => entry.insert ?? [])
    .find((entry) => entry.id === 'file-review-apply-patch')
  if (patchTool?.name !== '@deepseek-ai/dsh-tool-fs') {
    throw new Error('插件安装配置缺少官方 apply_patch 工具')
  }
  await ctx.plugin(FileTools, FileTools.Config(patchTool.config)).await()
  await ctx.plugin(FileReview).await()
  const handle = await ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd } })
  return { ctx, agent: handle.agent }
}

/** 通过新版执行器记录真实的工具调用和执行结果。 */
export async function executeTool(
  ctx: Context,
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
) {
  const callId = ToolCallId(randomUUID())
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool_call', id: callId, name, arguments: JSON.stringify(args) }],
    agent,
    signal: new AbortController().signal,
    log: { turn: 1, step: 1 },
  })
  const result = batch.results[0]?.result
  if (result === undefined) throw new Error('工具批次没有返回执行结果')
  return { callId, result }
}
