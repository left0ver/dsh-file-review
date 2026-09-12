#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshInvocation, seedRuntimeState } from './dsh-runtime.mjs'

const [rawPort] = process.argv.slice(2)
const port = Number.parseInt(rawPort ?? '', 10)

if (!Number.isInteger(port)) {
  console.error('Usage: node e2e/start-dsh.mjs <port>')
  process.exit(2)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = path.join(root, '.e2e/dsh-home-standalone')
const profileDir = path.join(dshHome, 'profiles/web')
const profileManifest = path.join(profileDir, 'package.json')
const pluginEnvironment = { ...process.env, DSH_HOME: dshHome }

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
  const invocation = dshInvocation(['plugin', '--profile', 'web', ...args])
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    env: pluginEnvironment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`dsh plugin ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

seedRuntimeState({ dshHome, root })

const launchUrlFile = path.join(root, `.e2e/dsh-web-${port}.url`)
writeFileSync(launchUrlFile, '', { mode: 0o600 })
chmodSync(launchUrlFile, 0o600)

const manifest = readManifest()
const expectedFileReviewLink = `link:${root}`
if (
  manifest?.dependencies?.['dsh-file-review'] !== expectedFileReviewLink ||
  !isBundle(manifest, 'dsh-file-review') ||
  !installed('dsh-file-review')
) {
  runPlugin('add', root)
}

const webInvocation = dshInvocation([
  'web',
  '--patch',
  path.join(root, 'e2e/dsh.patch.yml'),
  '--no-open',
  '--port',
  String(port),
])
const child = spawn(webInvocation.command, webInvocation.args, {
  cwd: root,
  env: pluginEnvironment,
  stdio: ['inherit', 'pipe', 'inherit'],
})

let pendingOutput = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk)
  pendingOutput += chunk
  const match = pendingOutput.match(
    /dsh web: (http:\/\/127\.0\.0\.1:\d+(?:\/\?token=[A-Za-z0-9_-]+)?)/u,
  )
  if (match === null) return
  writeFileSync(launchUrlFile, `${match[1]}\n`)
  pendingOutput = ''
})

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
