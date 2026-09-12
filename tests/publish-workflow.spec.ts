import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')

describe('publish workflow', () => {
  // 验证发布工作流要求 macOS 和 Windows 的 E2E 任务完成后，才能进入发布任务。
  it('runs E2E on macOS and Windows before publishing', () => {
    expect(workflow).toContain('- macos-latest')
    expect(workflow).toContain('- windows-latest')
    expect(workflow).not.toContain('ubuntu-latest\n    env:')
    expect(workflow).toContain('needs: e2e')
  })

  // 验证 E2E 失败时按平台上传 Playwright 和 Midscene 的诊断文件。
  it("uploads each platform's Playwright diagnostics on failure", () => {
    expect(workflow).toContain('uses: actions/upload-artifact@v7')
    expect(workflow).toContain('if: failure()')
    expect(workflow).toContain('name: e2e-${{ matrix.os }}')
    expect(workflow).toContain('test-results/')
    expect(workflow).toContain('playwright-report/')
    expect(workflow).toContain('midscene_run/')
  })
})
