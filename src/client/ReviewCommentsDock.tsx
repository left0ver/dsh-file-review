/** Interactive aggregate review-comment chip and preview above the composer. */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import {
  clearReviewComments, reviewComments, subscribeReviewComments,
} from './review-comments.ts'
import css from './ProducedFiles.module.css'

export type ReviewCommentsDockProps = PropsRuntime<'conversation.input.dock'>
  & PropsLocale<typeof NS>

function CommentIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.commentDockIcon}>
      <path d="M4 4.5h12v8H9l-3.5 3v-3H4v-8Z" />
      <path d="M7 7.5h6M7 10h4" />
    </svg>
  )
}

/** Render one session's aggregate chip; the hidden model reference remains in the draft. */
export function ReviewCommentsDock({ sessionId, t }: ReviewCommentsDockProps) {
  const [version, setVersion] = useState(0)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const comments = reviewComments(sessionId)

  useEffect(() => subscribeReviewComments(sessionId, () => {
    setVersion(value => value + 1)
  }), [sessionId])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Keep the state subscription observable to React without changing the
  // repository's intentionally simple in-memory store contract.
  void version
  if (comments.length === 0) return null
  const countLabel = comments.length === 1
    ? t('review.commentCountOne')
    : t('review.commentCount', { count: String(comments.length) })

  return (
    <div ref={rootRef} className={css.commentDock} data-review-comments-dock="">
      {open && (
        <div className={css.commentPreview} role="dialog" aria-label={t('review.commentPreview')}>
          {comments.map((comment) => {
            const side = comment.anchor.kind === 'del'
              ? t('review.commentSideLeft')
              : t('review.commentSideRight')
            const line = comment.anchor.kind === 'del'
              ? comment.anchor.oldLine
              : comment.anchor.newLine
            return (
              <article
                key={`${comment.turn}:${comment.closingSeq}:${comment.anchor.path}:${comment.anchor.hunkIndex}:${comment.anchor.rowIndex}`}
                className={css.commentPreviewCard}
              >
                <header className={css.commentPreviewHeader}>
                  <span className={css.commentPreviewPath} title={comment.anchor.path}>
                    {comment.anchor.path}
                  </span>
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
      <div className={css.commentDockPill}>
        <button
          type="button"
          className={css.commentDockOpen}
          aria-expanded={open}
          aria-label={t('review.commentOpenPreview', { count: String(comments.length) })}
          onClick={() => { setOpen(value => !value) }}
        >
          <CommentIcon />
          <span>{countLabel}</span>
        </button>
        <button
          type="button"
          className={css.commentDockRemove}
          aria-label={t('review.commentRemoveAll')}
          onClick={() => {
            clearReviewComments(sessionId)
            setOpen(false)
          }}
        >×</button>
      </div>
    </div>
  )
}
