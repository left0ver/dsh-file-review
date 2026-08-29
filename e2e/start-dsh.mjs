#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const variants = new Set(['standalone', 'better-sidebar'])
const [variant, rawPort] = process.argv.slice(2)
const port = Number.parseInt(rawPort ?? '', 10)

if (variant === undefined || !variants.has(variant) || !Number.isInteger(port)) {
  console.error('Usage: node e2e/start-dsh.mjs <standalone|better-sidebar> <port>')
  process.exit(2)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const legacyHome = path.join(root, '.e2e/dsh-home')
const dshHome =
  variant === 'standalone'
    ? path.join(root, '.e2e/dsh-home-standalone')
    : path.join(root, '.e2e/dsh-home-better-sidebar')
const profileDir = path.join(dshHome, 'profiles/web')
const profileManifest = path.join(profileDir, 'package.json')
const pluginEnvironment = { ...process.env, DSH_HOME: dshHome }

function seedRuntimeState() {
  if (!existsSync(legacyHome)) return

  mkdirSync(dshHome, { recursive: true })
  const sourceSettings = path.join(legacyHome, 'settings.yaml')
  const targetSettings = path.join(dshHome, 'settings.yaml')
  if (existsSync(sourceSettings) && !existsSync(targetSettings)) {
    copyFileSync(sourceSettings, targetSettings)
  }

  const sourceWorkspace = path.join(legacyHome, 'storages/workspace.json')
  const targetWorkspace = path.join(dshHome, 'storages/workspace.json')
  if (!existsSync(sourceWorkspace) || existsSync(targetWorkspace)) return

  const workspaceState = JSON.parse(readFileSync(sourceWorkspace, 'utf8'))
  workspaceState.global.archivedSessionIds = []
  for (const workspace of Object.values(workspaceState.tables.workspaces)) {
    workspace.sessionIds = []
  }
  mkdirSync(path.dirname(targetWorkspace), { recursive: true })
  writeFileSync(targetWorkspace, `${JSON.stringify(workspaceState, null, 2)}\n`)
}

function readManifest() {
  if (!existsSync(profileManifest)) return undefined
  return JSON.parse(readFileSync(profileManifest, 'utf8'))
}

function installed(packageName) {
  return existsSync(path.join(profileDir, 'node_modules', packageName, 'package.json'))
}

function isBundle(manifest, packageName) {
  return manifest?.dsh?.profile?.bundles?.includes(packageName) === true
}

function runPlugin(...args) {
  const result = spawnSync('dsh', ['plugin', '--profile', 'web', ...args], {
    cwd: root,
    env: pluginEnvironment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`dsh plugin ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function allowNodePtyBuild() {
  const workspaceFile = path.join(profileDir, 'pnpm-workspace.yaml')
  const source = readFileSync(workspaceFile, 'utf8')
  if (/^\s+node-pty:\s*true\s*$/m.test(source)) return

  const allowBuilds = /^allowBuilds:\s*$/m
  const next = allowBuilds.test(source)
    ? source.replace(allowBuilds, 'allowBuilds:\n  node-pty: true')
    : `${source.trimEnd()}\n\nallowBuilds:\n  node-pty: true\n`
  writeFileSync(workspaceFile, next)
}

seedRuntimeState()

let manifest = readManifest()
const expectedFileReviewLink = `link:${root}`
if (
  manifest?.dependencies?.['dsh-file-review'] !== expectedFileReviewLink ||
  !isBundle(manifest, 'dsh-file-review') ||
  !installed('dsh-file-review')
) {
  runPlugin('add', root)
  manifest = readManifest()
}

if (variant === 'standalone') {
  if (
    manifest?.dependencies?.['dsh-better-sidebar'] !== undefined ||
    isBundle(manifest, 'dsh-better-sidebar')
  ) {
    runPlugin('remove', 'dsh-better-sidebar')
  }
} else {
  allowNodePtyBuild()
  const sidebarSpec = process.env.E2E_BETTER_SIDEBAR_SPEC ?? 'dsh-better-sidebar@latest'
  runPlugin('add', sidebarSpec)
}

const child = spawn(
  'dsh',
  ['web', '--patch', path.join(root, 'e2e/dsh.patch.yml'), '--no-open', '--port', String(port)],
  {
    cwd: root,
    env: pluginEnvironment,
    stdio: 'inherit',
  },
)

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal)
}
process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
