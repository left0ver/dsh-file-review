/**
 * User-text projection that keeps the model-only review envelope behind a compact pill.
 * The host renders every user message through UserText rules, so this plugin contributes
 * one rule for its leading envelope instead of replacing the whole message renderer.
 */

import { useMemo } from 'react'
import type { UserTextNode, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { ReviewCommentPill } from './ReviewCommentPill.tsx'

const REVIEW_START = '<file_review_comments>'
const REVIEW_END = '</file_review_comments>'

/** UserText node ID, also the keyed renderer's key. */
export const REVIEW_COMMENTS_TEXT_ID = 'file-review-comments'

export interface ProjectedReviewComment {
  readonly path: string
  readonly kind: 'context' | 'del' | 'add'
  readonly oldLine: string
  readonly newLine: string
  readonly body: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    /** Leading review envelope emitted by this plugin, projected to its comments. */
    'file-review-comments': {
      readonly comments: readonly ProjectedReviewComment[]
    }
  }
}

interface ReviewEnvelope {
  readonly comments: readonly ProjectedReviewComment[]
  /** End of the closing tag. */
  readonly end: number
  /** Start of the user's own text, after at most two separator newlines. */
  readonly bodyStart: number
}

function unescapeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
}

function projectedComments(serialized: string): readonly ProjectedReviewComment[] {
  const comments: ProjectedReviewComment[] = []
  const filePattern = /<file path="([^"]*)">([\s\S]*?)<\/file>/g
  let fileMatch: RegExpExecArray | null
  while ((fileMatch = filePattern.exec(serialized)) !== null) {
    const path = unescapeXml(fileMatch[1] ?? '')
    const fileBody = fileMatch[2] ?? ''
    const commentPattern =
      /<comment kind="(context|del|add)" old_line="([^"]*)" new_line="([^"]*)">([\s\S]*?)<\/comment>/g
    let commentMatch: RegExpExecArray | null
    while ((commentMatch = commentPattern.exec(fileBody)) !== null) {
      const feedback = /<feedback>([\s\S]*?)<\/feedback>/.exec(commentMatch[4] ?? '')
      comments.push({
        path,
        kind: commentMatch[1] as ProjectedReviewComment['kind'],
        oldLine: commentMatch[2] ?? '',
        newLine: commentMatch[3] ?? '',
        body: unescapeXml(feedback?.[1] ?? ''),
      })
    }
  }
  return comments
}

/** Recognize only the leading envelope emitted by this plugin; user text after it is kept. */
export function matchReviewEnvelope(text: string): ReviewEnvelope | null {
  if (!text.startsWith(REVIEW_START)) return null
  const close = text.indexOf(REVIEW_END, REVIEW_START.length)
  if (close < 0) return null
  const end = close + REVIEW_END.length
  const comments = projectedComments(text.slice(0, end))
  if (comments.length === 0) return null
  const separator = /^\n{1,2}/.exec(text.slice(end))?.[0].length ?? 0
  return { comments, end, bodyStart: end + separator }
}

/**
 * Project the envelope to one review node, and its separator to a single display line
 * break so the user's text starts below the pill (or nothing when no text follows).
 */
export const reviewCommentsTextRule: UserTextRule<typeof REVIEW_COMMENTS_TEXT_ID> = {
  id: REVIEW_COMMENTS_TEXT_ID,
  // Ahead of the host whitespace rules, which may claim the same separator start.
  order: -10,
  match(text, from) {
    const envelope = matchReviewEnvelope(text)
    if (envelope === null) return undefined
    if (from === 0) {
      return {
        id: REVIEW_COMMENTS_TEXT_ID,
        start: 0,
        end: envelope.end,
        data: { comments: envelope.comments },
      }
    }
    if (from > envelope.end || envelope.bodyStart === envelope.end) return undefined
    const separator: UserTextNode<'text'> = {
      id: 'text',
      start: envelope.end,
      end: envelope.bodyStart,
      data: {
        text: text.slice(envelope.end, envelope.bodyStart),
        display: envelope.bodyStart < text.length ? '\n' : '',
      },
    }
    return separator
  },
}

export type ReviewCommentsTextProps = PropsRuntime<
  'conversation.user.text.node',
  typeof REVIEW_COMMENTS_TEXT_ID
> &
  PropsLocale<typeof NS> & {
    readonly projectRoot?: string | undefined
  }

/** Render the projected envelope as the shared review-comment pill. */
export function ReviewCommentsText({ node, projectRoot, t }: ReviewCommentsTextProps) {
  const comments = useMemo(
    () => node.data.comments.map((comment, index) => ({ ...comment, key: index })),
    [node.data.comments],
  )
  return (
    <ReviewCommentPill
      comments={comments}
      projectRoot={projectRoot}
      t={t}
      placement="below-right"
      variant="message"
    />
  )
}
