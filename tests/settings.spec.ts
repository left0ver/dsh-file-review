import { describe, expect, it } from 'vitest'
import * as FileReview from '../src/index.ts'

describe('file-review settings', () => {
  // 验证默认显示设置与无效布局。
  it('exposes volatile defaults and validates the layout', () => {
    const config = FileReview.Config({})
    expect(config.wordWrap.get()).toBe(false)
    expect(config.diffLayout.get()).toBe('split')
    expect(() => FileReview.Config({ diffLayout: 'invalid' })).toThrow()
  })
})
