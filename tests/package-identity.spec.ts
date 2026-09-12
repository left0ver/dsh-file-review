import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TYPERT_REMOTE } from '../src/remote.ts'
import { TYPERT } from '../src/typert.host.ts'
import { FILE_REVIEW_INVOCATIONS } from '../src/typert-descriptors.ts'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  files: string[]
}

describe('package identity', () => {
  // 验证 Cordis 加载配置使用 package.json 中的实际包名，不引用旧的作用域包名。
  it('uses the manifest package name in the Cordis loader entry', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(patch).toContain(`name: '${manifest.name}'`)
    expect(patch).not.toContain('@deepseek-ai/dsh-file-review')
  })

  // 验证服务端和客户端的远程接口使用统一包名，且状态查询与修改接口标识一致。
  it('uses the manifest package name throughout both Typert contributions', () => {
    expect(TYPERT.package).toBe(manifest.name)
    expect(TYPERT_REMOTE.package).toBe(manifest.name)
    expect(FILE_REVIEW_INVOCATIONS.map(({ id }) => id)).toEqual([
      `${manifest.name}#fileReview/status`,
      `${manifest.name}#fileReview/apply`,
    ])
    expect(JSON.stringify(FILE_REVIEW_INVOCATIONS)).not.toContain('@deepseek-ai/dsh-file-review')
  })

  // 验证发布清单包含 README 预览图，并使用正确拼写的 assets 目录。
  it('publishes the README preview image from the correctly named assets directory', () => {
    expect(manifest.files).toContain('assets/preview.png')
    expect(manifest.files.some((file) => file.startsWith('assests/'))).toBe(false)
  })
})
