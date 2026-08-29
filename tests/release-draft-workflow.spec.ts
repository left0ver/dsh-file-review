import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../.github/workflows/release-draft.yml', import.meta.url),
  'utf8',
)

const extractRunBlock = (name: string): string => {
  const lines = workflow.split('\n')
  const step = lines.findIndex((line) => line === `      - name: ${name}`)
  const run = lines.findIndex((line, index) => index > step && line === '        run: |')
  const end = lines.findIndex((line, index) => index > run && line.startsWith('      - name: '))
  if (step === -1 || run === -1) throw new Error(`Workflow step not found: ${name}`)

  return lines
    .slice(run + 1, end === -1 ? undefined : end)
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n')
}

type ReleaseApiMode = 'not-found' | 'published'

const runCreateStep = (apiMode: ReleaseApiMode) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-release-draft-'))
  const bin = join(root, 'bin')
  const calls = join(root, 'gh-calls.log')
  const notesDir = join(root, '.release-notes')
  mkdirSync(bin)
  mkdirSync(notesDir)
  writeFileSync(join(notesDir, 'RELEASE_NOTES_v0.5.3-rc.1.md'), '# v0.5.3-rc.1 Test\n\n- Test\n')

  const gh = join(bin, 'gh')
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$GH_CALL_LOG"
if [[ "$1" == "api" ]]; then
  case "$GH_API_MODE" in
    published)
      printf '%s\n' 'false'
      exit 0
      ;;
    not-found)
      printf '%s\n' '{"message":"Not Found","status":"404"}'
      printf '%s\n' 'gh: Not Found (HTTP 404)' >&2
      exit 1
      ;;
  esac
fi
if [[ "$1 $2" == "release create" ]]; then exit 0; fi
exit 97
`,
  )
  chmodSync(gh, 0o755)

  try {
    const result = spawnSync(
      'bash',
      ['-c', extractRunBlock('Create or update concise draft release')],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GH_API_MODE: apiMode,
          GH_CALL_LOG: calls,
          GITHUB_REPOSITORY: 'left0ver/dsh-file-review',
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_STEP_SUMMARY: join(root, 'step-summary'),
          OVERWRITE_EXISTING_DRAFT: 'false',
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          TARGET_TAG: 'v0.5.3-rc.1',
        },
      },
    )
    return { calls: readFileSync(calls, 'utf8'), result }
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

describe('release draft workflow', () => {
  it('creates a draft when no release exists', () => {
    const { calls, result } = runCreateStep('not-found')

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(calls).toContain('release create v0.5.3-rc.1 --verify-tag --draft --prerelease')
  })

  it('refuses to overwrite a published release', () => {
    const { calls, result } = runCreateStep('published')

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Release v0.5.3-rc.1 is already published')
    expect(calls).not.toContain('release create')
  })
})
