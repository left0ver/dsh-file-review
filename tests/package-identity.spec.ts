import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TYPERT_REMOTE } from '../src/remote.ts'
import { TYPERT } from '../src/typert.host.ts'
import { FILE_REVIEW_INVOCATIONS } from '../src/typert-descriptors.ts'

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string }

describe('package identity', () => {
  it('uses the manifest package name in the Cordis loader entry', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(patch).toContain(`name: '${manifest.name}'`)
    expect(patch).not.toContain('@deepseek-ai/dsh-file-review')
  })

  it('uses the manifest package name throughout both Typert contributions', () => {
    expect(TYPERT.package).toBe(manifest.name)
    expect(TYPERT_REMOTE.package).toBe(manifest.name)
    expect(FILE_REVIEW_INVOCATIONS.map(({ id }) => id)).toEqual([
      `${manifest.name}#fileReview/status`,
      `${manifest.name}#fileReview/apply`,
    ])
    expect(JSON.stringify(FILE_REVIEW_INVOCATIONS)).not.toContain('@deepseek-ai/dsh-file-review')
  })
})
