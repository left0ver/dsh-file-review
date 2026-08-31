import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const cache = mkdtempSync(join(tmpdir(), 'dsh-file-review-pack-'))
const runtimeFiles = new Set([
  'lib/client.js',
  'lib/client.js.map',
  'lib/index.js',
  'lib/remote.js',
  'lib/typert-descriptors.js',
  'lib/typert.host.js',
])

function parsePackOutput(output) {
  for (
    let offset = output.lastIndexOf('[');
    offset >= 0;
    offset = output.lastIndexOf('[', offset - 1)
  ) {
    try {
      return JSON.parse(output.slice(offset))
    } catch {
      // npm lifecycle output can precede the JSON payload; keep looking for its outer array.
    }
  }
  throw new Error(`npm pack did not return a JSON payload:\n${output}`)
}

try {
  const result = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HUSKY: '0', npm_config_cache: cache },
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const [pack] = parsePackOutput(result.stdout)
  const files = new Set(pack.files.map((entry) => entry.path))
  for (const required of [
    'assets/preview.png',
    'assets/preview_with_better_sidebar.png',
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
    if (/^lib\/[^/]+\.js(?:\.map)?$/.test(file) && !runtimeFiles.has(file)) {
      throw new Error(`npm package contains stale runtime output ${file}`)
    }
    const declaration = /^lib\/types\/(.+)\.d\.ts(?:\.map)?$/.exec(file)
    if (
      declaration !== null &&
      !['.ts', '.tsx'].some((extension) =>
        existsSync(resolve(root, `src/${declaration[1]}${extension}`)),
      )
    ) {
      throw new Error(`npm package contains orphaned declaration output ${file}`)
    }
  }
  console.log(`verify-pack: ${String(files.size)} publish files, standalone artifacts present.`)
} finally {
  rmSync(cache, { recursive: true, force: true })
}
