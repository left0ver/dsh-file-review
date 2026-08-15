/** Shared wire vocabulary for inspecting and toggling one turn's text changes. */

/** One validated contextual diff hunk attached to a produced file. */
export interface ProducedFileDiff {
  readonly path: string
  readonly oldText: string | null
  readonly newText: string
  readonly oldStart?: number | undefined
  readonly newStart?: number | undefined
}

/** One produced file and the applied hunks available for review. */
export interface ProducedFileReview {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
}

/** Direction requested by the produced-files toggle. */
export type FileReviewAction = 'undo' | 'redo'

/** One turn-scoped file supplied to the Host toggle service. */
export interface FileReviewChange {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
}

/** Host request for status inspection or one toggle direction. */
export interface FileReviewRequest {
  readonly action: FileReviewAction
  readonly files: readonly FileReviewChange[]
}

/** Current relationship between a file and the recorded turn change. */
export type FileReviewFileState = 'applied' | 'undone' | 'conflict' | 'unsupported' | 'error'

/** Per-file result; a request never hides skipped or failed files. */
export interface FileReviewFileResult {
  readonly path: string
  readonly state: FileReviewFileState
  readonly changed: boolean
  readonly reason?: string | undefined
}

/** Complete result returned by both Host endpoints. */
export interface FileReviewResult {
  readonly files: readonly FileReviewFileResult[]
}

