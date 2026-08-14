/** `file-review` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'file-review'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'produced.label': '产物',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.open': '打开 {name}',
  'produced.review': '审查 {name}',
  'produced.showInFolder': '在文件夹中显示',
  'review.title': '审查 {name}',
  'review.close': '关闭',
  'review.openInEditor': '在编辑器中打开',
  'review.copy': '复制',
  'review.copied': '复制成功',
  'review.showUnchanged': '{count} 行未修改',
  'review.hideUnchanged': '收起 {count} 行未修改内容',
  'review.unavailable': '此修改没有可重建的差异。你仍然可以打开当前文件。',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.review': 'Review {name}',
  'produced.showInFolder': 'Show in folder',
  'review.title': 'Review {name}',
  'review.close': 'Close',
  'review.openInEditor': 'Open in editor',
  'review.copy': 'Copy',
  'review.copied': 'Copied',
  'review.showUnchanged': '{count} unchanged lines',
  'review.hideUnchanged': 'Hide {count} unchanged lines',
  'review.unavailable': 'No reconstructable diff is available for this change. You can still open the current file.',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh
