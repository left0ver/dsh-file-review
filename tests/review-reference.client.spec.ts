import { afterEach, describe, expect, it } from 'vitest'
import { reviewCommentSource, REVIEW_COMMENT_SOURCE } from '../src/client/review-reference.ts'
import {
  clearAllReviewComments,
  clearReviewComments,
  reviewComments,
  serializeReviewComments,
  setReviewComment,
} from '../src/client/review-comments.ts'

function comment(sessionId: string, rowIndex: number, body: string) {
  return {
    sessionId,
    turn: 2,
    closingSeq: 9,
    body,
    anchor: {
      path: 'src/a.ts',
      hunkIndex: 0,
      rowIndex,
      kind: 'add' as const,
      oldLine: null,
      newLine: rowIndex + 1,
      text: `line ${rowIndex}`,
      excerpt: `+ line ${rowIndex}`,
    },
  }
}

afterEach(clearAllReviewComments)

// 输入框交互由真实宿主 E2E 验证，此处验证评论存储和 reference codec。
describe('审查评论 reference codec', () => {
  it('按会话保存和清除评论', () => {
    setReviewComment(comment('session-1', 0, 'First session'))
    setReviewComment(comment('session-2', 1, 'Second session'))
    expect(reviewComments('session-1').map((value) => value.body)).toEqual(['First session'])
    expect(reviewComments('session-2').map((value) => value.body)).toEqual(['Second session'])
    clearReviewComments('session-1')
    expect(reviewComments('session-1')).toHaveLength(0)
    expect(reviewComments('session-2')).toHaveLength(1)
  })

  it('提交时序列化当前评论并保留评论记录', async () => {
    const codec = reviewCommentSource().codec!
    expect(reviewCommentSource().name).toBe(REVIEW_COMMENT_SOURCE)
    setReviewComment(comment('session-1', 0, 'First'))
    setReviewComment(comment('session-1', 1, 'Second'))
    const signal = new AbortController().signal
    expect(await codec.serialize('session-1', signal)).toBe(
      `${serializeReviewComments('session-1')}\n\n`,
    )
    setReviewComment(comment('session-1', 1, 'Updated'))
    const serialized = await codec.serialize('session-1', signal)
    expect(serialized).toContain('<feedback>Updated</feedback>')
    expect(serialized).not.toContain('<feedback>Second</feedback>')
    expect(reviewComments('session-1')).toHaveLength(2)
  })

  it('引用序列化取消后保留评论', async () => {
    setReviewComment(comment('session-1', 0, 'Pending'))
    const controller = new AbortController()
    controller.abort(new Error('提交已取消'))
    await expect(
      reviewCommentSource().codec!.serialize('session-1', controller.signal),
    ).rejects.toThrow('提交已取消')
    expect(reviewComments('session-1')).toHaveLength(1)
  })

  it('评论已经全部清除时拒绝序列化', async () => {
    setReviewComment(comment('session-1', 0, 'Sent'))
    clearReviewComments('session-1')
    await expect(
      reviewCommentSource().codec!.serialize('session-1', new AbortController().signal),
    ).rejects.toThrow('No review comments are available')
  })
})
