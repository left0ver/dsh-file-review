/** Interactive aggregate review-comment chip and preview above the composer. */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import {
  clearReviewComments, reviewComments, subscribeReviewComments,
} from './review-comments.ts'
import { ReviewCommentPill } from './ReviewCommentPill.tsx'
import css from './ProducedFiles.module.css'

export type ReviewCommentsDockProps = PropsRuntime<'conversation.input.dock'>
  & PropsLocale<typeof NS>
  & { readonly projectRoot?: string | undefined }

/** Render one session's aggregate chip; the hidden model reference remains in the draft. */
export function ReviewCommentsDock({ sessionId, projectRoot, t }: ReviewCommentsDockProps) {
  const [version, setVersion] = useState(0)
  const comments = reviewComments(sessionId)

  useEffect(() => subscribeReviewComments(sessionId, () => {
    setVersion(value => value + 1)
  }), [sessionId])

  // Keep the state subscription observable to React without changing the
  // repository's intentionally simple in-memory store contract.
  void version
  if (comments.length === 0) return null
  return (
    <div className={css.commentDock} data-review-comments-dock="">
      <ReviewCommentPill
        comments={comments.map(comment => ({
          key: `${comment.turn}:${comment.closingSeq}:${comment.anchor.path}:${comment.anchor.hunkIndex}:${comment.anchor.rowIndex}`,
          path: comment.anchor.path,
          kind: comment.anchor.kind,
          oldLine: comment.anchor.oldLine,
          newLine: comment.anchor.newLine,
          body: comment.body,
        }))}
        projectRoot={projectRoot}
        t={t}
        placement="above-left"
        variant="dock"
        buttonLabel={t('review.commentOpenPreview', { count: String(comments.length) })}
        trailingAction={(
          <button
            type="button"
            className={css.commentDockRemove}
            aria-label={t('review.commentRemoveAll')}
            onClick={() => { clearReviewComments(sessionId) }}
          >×</button>
        )}
      />
    </div>
  )
}
