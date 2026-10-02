#!/usr/bin/env node

// Moves every DSH version reference together:
// - devDependencies and dsh.adapter.cliVersion pin the exact version E2E ran against;
// - dependencies and peerDependencies accept a range, because DSH denies a plugin whose
//   @deepseek-ai/dsh-* peers do not satisfy the running version (prereleases included).
// Usage: node scripts/bump-dsh.mjs <tested-version> [--peer <range>]

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const README_FILES = ['README.md', 'README.zh.md']
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/
const BADGE = /(img\.shields\.io\/badge\/DSH_CLI-)[^-]+(?:--[^-]+)*(-[0-9a-f]{6})/g

function parseArguments(argv) {
  const options = { tested: undefined, peer: undefined }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--peer') {
      options.peer = argv[index + 1]
      if (!options.peer) throw new Error('--peer requires a semver range')
      index += 1
    } else if (!argument.startsWith('-') && options.tested === undefined) {
      options.tested = argument
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }

  if (!options.tested) {
    throw new Error('usage: node scripts/bump-dsh.mjs <tested-version> [--peer <range>]')
  }
  const match = VERSION.exec(options.tested)
  if (!match) throw new Error(`not an exact semantic version: ${options.tested}`)
  // Default: every prerelease and the release of the tested patch line, since DSH 0.x
  // patch releases have broken this plugin before.
  const [, major, minor, patch] = match
  options.peer ??= `>=${options.tested} <${major}.${minor}.${Number(patch) + 1}-0`
  return options
}

function isDshPackage(name) {
  return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
}

function setDshVersions(dependencies, version) {
  for (const name of Object.keys(dependencies ?? {})) {
    if (isDshPackage(name)) dependencies[name] = version
  }
}

function badgeVersion(version) {
  return version.replaceAll('-', '--').replaceAll('_', '__')
}

const { tested, peer } = parseArguments(process.argv.slice(2))

const manifestPath = resolve(ROOT, 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
setDshVersions(manifest.devDependencies, tested)
setDshVersions(manifest.dependencies, peer)
setDshVersions(manifest.peerDependencies, peer)
manifest.dsh.adapter.cliVersion = tested
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

for (const file of README_FILES) {
  const path = resolve(ROOT, file)
  const content = await readFile(path, 'utf8')
  const updated = content.replace(BADGE, `$1${badgeVersion(tested)}$2`)
  if (updated === content && !content.includes(`DSH_CLI-${badgeVersion(tested)}-`)) {
    throw new Error(`${file} has no DSH CLI badge to update`)
  }
  await writeFile(path, updated)
}

console.log(`bump-dsh: tested ${tested}; peers ${peer}.`)
console.log('Next: pnpm install, then npm run update:readme-i18n.')
