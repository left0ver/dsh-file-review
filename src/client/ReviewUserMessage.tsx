/** User-message projection that keeps serialized review context out of the visible bubble. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
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
  readonly images: readonly MessageImageSource[]
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

function contentParts(content: readonly unknown[]): ContentParts {
  const texts: string[] = []
  const images: MessageImageSource[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const value = block as {
      readonly type?: unknown
      readonly text?: unknown
      readonly attachment?: unknown
    }
    if (value.type === 'text' && typeof value.text === 'string') texts.push(value.text)
    else if (value.type === 'image' && value.attachment !== undefined) {
      images.push({ attachment: value.attachment } as MessageImageSource)
    } else rest.push(block)
  }
  return { text: texts.join(''), images, rest }
}

/** Match the host's compact reference treatment for ordinary user messages. */
function projectPlainReferences(text: string): ReactNode {
  const expression = /(^|\s)([/@][\w-]+)(?=\s|$)/g
  const parts: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = expression.exec(text)) !== null) {
    const tokenStart = match.index + (match[1]?.length ?? 0)
    const label = match[2] ?? ''
    if (tokenStart > cursor) {
      parts.push(<span key={cursor}>{text.slice(cursor, tokenStart)}</span>)
    }
    parts.push(
      <span
        key={tokenStart}
        className={css.reviewMessageReference}
        data-ref-chip={label.startsWith('@') ? 'subagent' : 'skill'}
      >
        {label}
      </span>,
    )
    cursor = tokenStart + label.length
  }
  if (parts.length === 0) return <span>{text}</span>
  if (cursor < text.length) parts.push(<span key={cursor}>{text.slice(cursor)}</span>)
  return parts
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

function ExtraBlock({ value, label }: { readonly value: unknown; readonly label: string }) {
  let serialized: string
  try {
    serialized = JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    serialized = String(value)
  }
  return (
    <details className={css.reviewMessageExtraBlock}>
      <summary>{label}</summary>
      <pre>{serialized}</pre>
    </details>
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

/** Shadow the host user renderer while preserving its ordinary-message behavior. */
export function ReviewUserMessage({
  node,
  cwd,
  renderMessageImages,
  t,
  reviewT,
}: UserMessageProps) {
  const { content, time } = node.data
  const { text, images, rest } = contentParts(content)
  const projection = projectReviewMessageText(text)
  const visibleText = projection?.visibleText ?? text
  const countLabel =
    projection === null
      ? null
      : projection.commentCount === 1
        ? reviewT('review.commentCountOne')
        : reviewT('review.commentCount', { count: String(projection.commentCount) })
  const copyText =
    projection === null
      ? text
      : [countLabel, visibleText].filter((value) => value !== null && value !== '').join('\n\n')
  const showBubble = visibleText !== '' || rest.length > 0

  return (
    <div className={css.reviewMessageRow} data-time-hover-root="">
      <div className={css.reviewMessageStack}>
        {images.length > 0 ? renderMessageImages({ images, align: 'end' }) : null}
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
        {showBubble && (
          <div className={css.reviewMessageBubble}>
            {projectPlainReferences(visibleText)}
            {rest.map((block, index) => (
              <ExtraBlock key={index} label={t('message.extraBlock')} value={block} />
            ))}
          </div>
        )}
      </div>
      <MessageActions text={copyText} time={time} t={t} />
    </div>
  )
}
