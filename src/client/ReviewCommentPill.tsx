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
  readonly lineText?: string | undefined
  readonly removeLabel?: string | undefined
  readonly onRemove?: (() => void) | undefined
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
  comments,
  projectRoot,
  t,
  placement,
  variant,
  buttonLabel,
  trailingAction,
}: ReviewCommentPillProps) {
  const previewId = useId()
  const [open, setOpen] = useState(false)
  const countLabel =
    comments.length === 1
      ? t('review.commentCountOne')
      : t('review.commentCount', { count: String(comments.length) })
  const rootClass =
    variant === 'dock'
      ? css.reviewCommentPillRoot
      : `${css.reviewCommentPillRoot} ${css.reviewCommentPillRootMessage}`
  const positionerClass =
    placement === 'above-left'
      ? `${css.reviewCommentPreviewPositioner} ${css.reviewCommentPreviewAbove}`
      : `${css.reviewCommentPreviewPositioner} ${css.reviewCommentPreviewBelow}`

  return (
    <div
      className={rootClass}
      onMouseEnter={() => {
        setOpen(true)
      }}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) setOpen(false)
      }}
      onFocus={() => {
        setOpen(true)
      }}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false)
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
        <div className={positionerClass} data-review-comment-hover-bridge="">
          <div
            id={previewId}
            className={css.reviewCommentPreview}
            role="tooltip"
            aria-label={t('review.commentPreview')}
          >
            {comments.map((comment) => {
              const side =
                comment.kind === 'del' ? t('review.commentSideLeft') : t('review.commentSideRight')
              const line = comment.kind === 'del' ? comment.oldLine : comment.newLine
              const path = displayProjectPath(comment.path, projectRoot)
              const snippet = comment.lineText?.trim() ?? ''
              return (
                <article
                  key={comment.key}
                  className={css.commentPreviewCard}
                  data-comment-kind={comment.kind}
                >
                  <header className={css.commentPreviewHeader}>
                    <span className={css.commentPreviewPath} title={path}>
                      {path}
                    </span>
                    <span className={css.commentPreviewLocation} data-location-kind={comment.kind}>
                      {t('review.commentLocation', { side, line: String(line ?? '') })}
                    </span>
                    {comment.onRemove !== undefined && (
                      <button
                        type="button"
                        className={css.commentPreviewRemove}
                        aria-label={comment.removeLabel ?? t('review.commentDelete')}
                        title={comment.removeLabel ?? t('review.commentDelete')}
                        onMouseDown={(event) => {
                          event.preventDefault()
                        }}
                        onClick={comment.onRemove}
                      >
                        <svg
                          viewBox="0 0 16 16"
                          aria-hidden="true"
                          className={css.commentPreviewRemoveIcon}
                        >
                          <path d="m4.5 4.5 7 7m0-7-7 7" />
                        </svg>
                      </button>
                    )}
                  </header>
                  {snippet.length > 0 && (
                    <div className={css.commentPreviewSnippet} data-snippet-kind={comment.kind}>
                      <span className={css.commentPreviewSign} aria-hidden="true">
                        {comment.kind === 'del' ? '-' : comment.kind === 'add' ? '+' : ' '}
                      </span>
                      <code className={css.commentPreviewCode}>{snippet}</code>
                    </div>
                  )}
                  <p className={css.commentPreviewBody}>{comment.body}</p>
                </article>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
