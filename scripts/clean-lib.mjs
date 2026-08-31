#!/usr/bin/env node

import { rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'lib')

if (dirname(output) !== root || basename(output) !== 'lib') {
  throw new Error(`refusing to clean unexpected build output: ${output}`)
}

await rm(output, { recursive: true, force: true })
console.log('clean-lib: removed generated lib output.')
