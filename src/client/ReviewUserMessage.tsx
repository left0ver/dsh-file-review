/** User-message projection that keeps serialized review context out of the visible bubble. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChatNodeViewProps,
  UserContentAttachment,
  UserContentData,
  UserContentInput,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { ReviewCommentPill } from './ReviewCommentPill.tsx'
import css from './ProducedFiles.module.css'

const REVIEW_START = '<file_review_comments>'
const REVIEW_END = '</file_review_comments>'

interface ProjectedReviewComment {
  readonly path: string
  readonly kind: 'context' | 'del' | 'add'
  readonly oldLine: string
  readonly newLine: string
  readonly body: string
}

interface ReviewMessageProjection {
  readonly commentCount: number
  readonly comments: readonly ProjectedReviewComment[]
  readonly visibleText: string
}

type UserMessageProps = ChatNodeViewProps<'user' | 'steering'> & {
  readonly reviewT: TranslateNS<typeof NS>
}

interface ContentParts {
  readonly text: string
  readonly attachments: readonly UserContentAttachment[]
  readonly rest: readonly unknown[]
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

/** Recognize only the leading envelope emitted by this plugin and retain any user text after it. */
export function projectReviewMessageText(text: string): ReviewMessageProjection | null {
  if (!text.startsWith(REVIEW_START)) return null
  const end = text.indexOf(REVIEW_END, REVIEW_START.length)
  if (end < 0) return null
  const serialized = text.slice(0, end + REVIEW_END.length)
  const comments = projectedComments(serialized)
  const commentCount = comments.length
  if (commentCount === 0) return null
  return {
    commentCount,
    comments,
    visibleText: text.slice(end + REVIEW_END.length).replace(/^\n{1,2}/, ''),
  }
}

/** Mirror the host split so files and images keep their original display order. */
function contentParts(content: readonly unknown[]): ContentParts {
  const texts: string[] = []
  const attachments: UserContentAttachment[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const value = block as {
      readonly type?: unknown
      readonly text?: unknown
      readonly attachment?: unknown
    }
    if (value.type === 'text' && typeof value.text === 'string') texts.push(value.text)
    else if (value.type === 'image' && value.attachment !== undefined) {
      attachments.push({
        type: 'image',
        image: { attachment: value.attachment },
      } as UserContentAttachment)
    } else if (value.type === 'file' && value.attachment !== undefined) {
      attachments.push({ type: 'file', file: value.attachment } as UserContentAttachment)
    } else rest.push(block)
  }
  return { text: texts.join(''), attachments, rest }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function messageClock(time: number, t: UserMessageProps['t']): string {
  const value = new Date(time)
  const today = new Date()
  const clock = `${pad2(value.getHours())}:${pad2(value.getMinutes())}`
  if (
    value.getFullYear() === today.getFullYear() &&
    value.getMonth() === today.getMonth() &&
    value.getDate() === today.getDate()
  )
    return clock
  const params = { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() }
  const date =
    value.getFullYear() === today.getFullYear() ? t('clock.md', params) : t('clock.ymd', params)
  return `${date} ${clock}`
}

async function writeText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard === undefined) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.reviewMessageActionIcon}>
      <path d="m4.5 10 3.5 3.5 7.5-7.5" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.reviewMessageActionIcon}>
      <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
      <path d="M13.5 6.5v-2a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" />
    </svg>
  )
}

function MessageActions({
  text,
  time,
  t,
}: {
  readonly text: string
  readonly time: number
  readonly t: UserMessageProps['t']
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const copy = useCallback(() => {
    if (copied) return
    void writeText(text).then((success) => {
      if (!success) return
      setCopied(true)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setCopied(false)
      }, 1000)
    })
  }, [copied, text])

  return (
    <div className={css.reviewMessageActions}>
      <span className={css.reviewMessageTime}>{messageClock(time, t)}</span>
      <button
        type="button"
        className={css.reviewMessageAction}
        title={copied ? t('copied') : t('copy')}
        aria-label={copied ? t('copied') : t('copy')}
        onClick={copy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  )
}

/** Shadow the host user renderer, delegating content to its Factory so host text rules still apply. */
export function ReviewUserMessage({
  node,
  cwd,
  loadImage,
  renderFactorySlot,
  t,
  reviewT,
}: UserMessageProps) {
  const { content, time, referenceLabels, skillNames } = node.data
  const parts = useMemo(() => contentParts(content), [content])
  const projection = useMemo(() => projectReviewMessageText(parts.text), [parts.text])
  const visibleText = projection?.visibleText ?? parts.text
  const prepared = useMemo<UserContentData>(
    () => ({
      text: visibleText,
      attachments: parts.attachments,
      extraBlocks: parts.rest,
      ...(referenceLabels === undefined ? {} : { referenceLabels }),
    }),
    [visibleText, parts, referenceLabels],
  )
  // Same Facts the host derives; skillNames is declared by an optional skill plugin.
  const facts = useMemo(() => {
    const value: Record<string, unknown> = {}
    if (referenceLabels !== undefined) value.sessionLabels = referenceLabels
    if (skillNames !== undefined) value.skillNames = skillNames
    return value as UserContentInput['facts']
  }, [referenceLabels, skillNames])
  const countLabel =
    projection === null
      ? null
      : projection.commentCount === 1
        ? reviewT('review.commentCountOne')
        : reviewT('review.commentCount', { count: String(projection.commentCount) })
  const copyText =
    projection === null
      ? parts.text
      : [countLabel, visibleText].filter((value) => value !== null && value !== '').join('\n\n')
  const showContent = visibleText !== '' || parts.attachments.length > 0 || parts.rest.length > 0

  return (
    <div className={css.reviewMessageRow} data-time-hover-root="">
      <div className={css.reviewMessageStack}>
        {countLabel !== null && projection !== null && (
          <ReviewCommentPill
            comments={projection.comments.map((comment, index) => ({
              ...comment,
              key: index,
            }))}
            projectRoot={cwd}
            t={reviewT}
            placement="below-right"
            variant="message"
          />
        )}
        {showContent &&
          renderFactorySlot('conversation.chat.user.content', {
            content: prepared,
            loadImage,
            facts,
            interactive: true,
          })}
      </div>
      <MessageActions text={copyText} time={time} t={t} />
    </div>
  )
}
