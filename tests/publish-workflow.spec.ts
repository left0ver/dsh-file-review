import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')

describe('publish workflow', () => {
  it('runs E2E on macOS and Windows before publishing', () => {
    expect(workflow).toContain('- macos-latest')
    expect(workflow).toContain('- windows-latest')
    expect(workflow).not.toContain('ubuntu-latest\n    env:')
    expect(workflow).toContain('needs: e2e')
  })

  it('installs the most recently published DSH CLI version, including prereleases', () => {
    expect(workflow).toContain('npm view @deepseek-ai/dsh time --json')
    expect(workflow).toContain(
      '.filter(([version]) => version !== "created" && version !== "modified")',
    )
    expect(workflow).toContain('.sort((left, right) => Date.parse(right[1]) - Date.parse(left[1]))')
    expect(workflow).toContain('npm install --global "@deepseek-ai/dsh@${dsh_version}"')
    expect(workflow.match(/\.filter\(\(\[version\]\)/g)).toHaveLength(1)
  })

  it("uploads each platform's Playwright diagnostics on failure", () => {
    expect(workflow).toContain('uses: actions/upload-artifact@v7')
    expect(workflow).toContain('if: failure()')
    expect(workflow).toContain('name: e2e-${{ matrix.os }}')
    expect(workflow).toContain('test-results/')
    expect(workflow).toContain('playwright-report/')
    expect(workflow).toContain('midscene_run/')
  })
})
