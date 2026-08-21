/** Shared aggregate review-comment pill with hover and keyboard preview. */

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { displayProjectPath } from './project-path.ts'
import css from './ProducedFiles.module.css'

export interface PreviewReviewComment {
  readonly key: string | number
  readonly path: string
  readonly kind: 'context' | 'del' | 'add'
  readonly oldLine: string | number | null
  readonly newLine: string | number | null
  readonly body: string
}

interface ReviewCommentPillProps {
  readonly comments: readonly PreviewReviewComment[]
  readonly projectRoot?: string | undefined
  readonly t: TranslateNS<typeof NS>
  readonly placement: 'above-left' | 'below-right'
  readonly variant: 'dock' | 'message'
  readonly buttonLabel?: string | undefined
  readonly trailingAction?: ReactNode
}

function CommentIcon({ variant }: Pick<ReviewCommentPillProps, 'variant'>) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={variant === 'dock' ? css.commentDockIcon : css.reviewMessageCommentIcon}
    >
      <path d="M4 4.5h12v8H9l-3.5 3v-3H4v-8Z" />
      <path d="M7 7.5h6M7 10h4" />
    </svg>
  )
}

/** One interaction contract for draft and historical review-comment references. */
export function ReviewCommentPill({
  comments, projectRoot, t, placement, variant, buttonLabel, trailingAction,
}: ReviewCommentPillProps) {
  const previewId = useId()
  const [open, setOpen] = useState(false)
  const countLabel = comments.length === 1
    ? t('review.commentCountOne')
    : t('review.commentCount', { count: String(comments.length) })
  const rootClass = variant === 'dock'
    ? css.reviewCommentPillRoot
    : `${css.reviewCommentPillRoot} ${css.reviewCommentPillRootMessage}`
  const previewClass = placement === 'above-left'
    ? `${css.reviewCommentPreview} ${css.reviewCommentPreviewAbove}`
    : `${css.reviewCommentPreview} ${css.reviewCommentPreviewBelow}`

  return (
    <div
      className={rootClass}
      onMouseEnter={() => { setOpen(true) }}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) setOpen(false)
      }}
      onFocus={() => { setOpen(true) }}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node)
          || !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <div className={variant === 'dock' ? css.commentDockPill : undefined}>
        <button
          type="button"
          className={variant === 'dock' ? css.commentDockOpen : css.reviewMessageCommentPill}
          data-review-comment-count={comments.length}
          aria-label={buttonLabel}
          aria-expanded={open}
          aria-describedby={open ? previewId : undefined}
        >
          <CommentIcon variant={variant} />
          <span>{countLabel}</span>
        </button>
        {trailingAction}
      </div>
      {open && (
        <div
          id={previewId}
          className={previewClass}
          role="tooltip"
          aria-label={t('review.commentPreview')}
        >
          {comments.map((comment) => {
            const side = comment.kind === 'del'
              ? t('review.commentSideLeft')
              : t('review.commentSideRight')
            const line = comment.kind === 'del' ? comment.oldLine : comment.newLine
            const path = displayProjectPath(comment.path, projectRoot)
            return (
              <article key={comment.key} className={css.commentPreviewCard}>
                <header className={css.commentPreviewHeader}>
                  <span className={css.commentPreviewPath} title={path}>{path}</span>
                  <span className={css.commentPreviewLocation}>
                    {t('review.commentLocation', { side, line: String(line ?? '') })}
                  </span>
                </header>
                <p className={css.commentPreviewBody}>{comment.body}</p>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
