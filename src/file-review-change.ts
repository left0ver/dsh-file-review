import type { ProducedFileDiff } from './change-types.ts'

function validMode(mode: number): boolean {
  return Number.isInteger(mode) && mode >= 0 && mode <= 0o777
}

/** Whether one diff carries enough information for a strict reverse operation. */
export function isReversibleDiff(diff: ProducedFileDiff, path: string): boolean {
  if (diff.path !== path) return false
  if (diff.lifecycle?.kind === 'create') {
    return diff.oldText === null && validMode(diff.lifecycle.mode)
  }
  if (diff.lifecycle?.kind === 'delete') {
    return typeof diff.oldText === 'string' && diff.newText === '' && validMode(diff.lifecycle.mode)
  }
  if (diff.lifecycle !== undefined || diff.oldText === null || diff.oldText === diff.newText) {
    return false
  }
  if (diff.oldText === '' && diff.oldStart === undefined) return false
  if (diff.newText === '' && diff.newStart === undefined) return false
  return true
}

/** Shared Host/browser classifier for one complete turn-scoped file change. */
export function isReversibleChange(file: {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  readonly complete?: false | undefined
}): boolean {
  return (
    file.complete !== false &&
    file.diffs.length > 0 &&
    file.diffs.every((diff) => isReversibleDiff(diff, file.path))
  )
}
