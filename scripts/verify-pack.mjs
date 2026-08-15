import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cache = mkdtempSync(join(tmpdir(), 'dsh-file-review-pack-'))
try {
  const result = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cache },
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const [pack] = JSON.parse(result.stdout)
  const files = new Set(pack.files.map((entry) => entry.path))
  for (const required of [
    'cordis.patch.yml',
    'lib/index.js',
    'lib/client.js',
    'lib/client.js.map',
    'lib/typert.host.js',
    'lib/remote.js',
    'lib/typert-descriptors.js',
    'lib/types/index.d.ts',
    'lib/types/client/index.d.ts',
    'lib/types/typert.host.d.ts',
    'lib/types/remote.d.ts',
  ]) {
    if (!files.has(required)) throw new Error(`npm package is missing ${required}`)
  }
  for (const file of files) {
    if (file.startsWith('src/') || file === 'tsconfig.json' || file === 'tsdown.config.ts') {
      throw new Error(`npm package leaked development input ${file}`)
    }
  }
  console.log(`verify-pack: ${String(files.size)} publish files, standalone artifacts present.`)
} finally {
  rmSync(cache, { recursive: true, force: true })
}
