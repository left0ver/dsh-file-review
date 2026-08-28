#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const README_FILES = ['README.md', 'README.zh.md']
const LEDGER_FILE = 'README.i18n.yaml'

function parseArguments(argv) {
  const options = { base: undefined, write: false }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--write') {
      options.write = true
    } else if (argument === '--base') {
      options.base = argv[index + 1]
      if (!options.base) throw new Error('--base requires a Git revision')
      index += 1
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }

  return options
}

function gitBlobHash(content) {
  const header = Buffer.from(`blob ${content.byteLength}\0`)
  return createHash('sha1').update(header).update(content).digest('hex')
}

function recordedHash(ledger, file) {
  const escapedFile = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...ledger.matchAll(new RegExp(`^${escapedFile}:\\s*([0-9a-f]{40})\\s*$`, 'gm'))]
  if (matches.length !== 1) {
    throw new Error(`${LEDGER_FILE} must contain exactly one SHA-1 entry for ${file}`)
  }
  return matches[0][1]
}

function headingLevels(markdown) {
  return [...markdown.matchAll(/^(#{1,6})[ \t]+/gm)].map((match) => match[1].length)
}

function listShape(markdown) {
  return [...markdown.matchAll(/^[ \t]*(?:(\d+)\.|([-+*]))[ \t]+/gm)].map((match) =>
    match[1] === undefined ? 'unordered' : 'ordered',
  )
}

function fencedCodeBlocks(markdown) {
  return [...markdown.matchAll(/^(```+|~~~+)([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm)].map((match) => ({
    language: match[2].trim(),
    body: match[3].replace(/\n$/, ''),
  }))
}

function linkDestinations(markdown) {
  return [...markdown.matchAll(/\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g)]
    .map((match) => match[1].replace(/^<|>$/g, ''))
    .filter((destination) => !/^README(?:\.zh)?\.md(?:#.*)?$/.test(destination))
}

function assertSameStructure(english, chinese) {
  const checks = [
    ['heading levels', headingLevels],
    ['list structure', listShape],
    ['fenced code blocks', fencedCodeBlocks],
    ['link and image destinations', linkDestinations],
  ]

  const differences = checks
    .filter(([, extract]) => JSON.stringify(extract(english)) !== JSON.stringify(extract(chinese)))
    .map(([label]) => label)

  if (differences.length > 0) {
    throw new Error(
      `README.md and README.zh.md differ in: ${differences.join(', ')}. ` +
        'Keep their document structure and non-translatable content aligned.',
    )
  }
}

function assertPairChangedTogether(base) {
  let output
  try {
    output = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMRD', `${base}...HEAD`, '--', ...README_FILES],
      { cwd: ROOT, encoding: 'utf8' },
    )
  } catch (error) {
    throw new Error(`cannot compare the README pair with ${base}: ${error.message}`)
  }

  const changed = new Set(output.split('\n').filter(Boolean))
  const changedCount = README_FILES.filter((file) => changed.has(file)).length
  if (changedCount === 1) {
    const changedFile = README_FILES.find((file) => changed.has(file))
    const missingFile = README_FILES.find((file) => !changed.has(file))
    throw new Error(
      `${changedFile} changed without ${missingFile}; update the bilingual README pair together`,
    )
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const [englishBuffer, chineseBuffer, ledgerBuffer] = await Promise.all([
    readFile(resolve(ROOT, README_FILES[0])),
    readFile(resolve(ROOT, README_FILES[1])),
    readFile(resolve(ROOT, LEDGER_FILE)),
  ])

  assertSameStructure(englishBuffer.toString('utf8'), chineseBuffer.toString('utf8'))
  if (options.base) assertPairChangedTogether(options.base)

  const hashes = new Map([
    [README_FILES[0], gitBlobHash(englishBuffer)],
    [README_FILES[1], gitBlobHash(chineseBuffer)],
  ])
  let ledger = ledgerBuffer.toString('utf8')

  if (options.write) {
    for (const [file, hash] of hashes) {
      recordedHash(ledger, file)
      ledger = ledger.replace(
        new RegExp(`^${file.replaceAll('.', '\\.')}:[^\n]*$`, 'm'),
        `${file}: ${hash}`,
      )
    }
    await writeFile(resolve(ROOT, LEDGER_FILE), ledger)
    console.log(`Updated ${LEDGER_FILE} after bilingual review.`)
    return
  }

  const staleFiles = README_FILES.filter((file) => recordedHash(ledger, file) !== hashes.get(file))
  if (staleFiles.length > 0) {
    throw new Error(
      `${LEDGER_FILE} is stale for: ${staleFiles.join(', ')}. ` +
        'Review both translations, then run npm run update:readme-i18n.',
    )
  }

  console.log('README translation structure and reviewed hashes are consistent.')
}

main().catch((error) => {
  console.error(`README i18n check failed: ${error.message}`)
  process.exitCode = 1
})
