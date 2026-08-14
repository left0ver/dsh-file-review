/** `file-review` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'file-review'

/** English dictionary (the key-set source of truth). */
export const en = {
  'produced.summary': 'Edited files',
  'produced.editedOne': 'Edited 1 file',
  'produced.edited': 'Edited {count} files',
  'produced.moreOne': '1 more file',
  'produced.more': '{count} more files',
  'produced.open': 'Open {name}',
  'produced.review': 'Review {name}',
  'produced.reviewAll': 'Review all produced files',
  'review.title': 'Review',
  'review.fileOne': '1 file',
  'review.files': '{count} files',
  'review.close': 'Close',
  'review.resize': 'Resize review panel',
  'review.resizeHint': 'Drag to resize. Double-click to reset.',
  'review.openInEditor': 'Open in editor',
  'review.copy': 'Copy diff',
  'review.copied': 'Copied',
  'review.showUnchanged': '{count} unchanged lines',
  'review.hideUnchanged': 'Hide {count} unchanged lines',
  'review.stats': '{added} lines added, {removed} lines removed',
  'review.unavailable': 'No reconstructable diff is available for this change. You can still open the current file.',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof en

/** Simplified Chinese dictionary. */
export const zh: Record<DeliverablesKey, string> = {
  'produced.summary': '已编辑文件',
  'produced.editedOne': '已编辑 1 个文件',
  'produced.edited': '已编辑 {count} 个文件',
  'produced.moreOne': '另有 1 个文件',
  'produced.more': '另有 {count} 个文件',
  'produced.open': '打开 {name}',
  'produced.review': '审查 {name}',
  'produced.reviewAll': '审查所有产出文件',
  'review.title': '审查',
  'review.fileOne': '1 个文件',
  'review.files': '{count} 个文件',
  'review.close': '关闭',
  'review.resize': '调整审查面板大小',
  'review.resizeHint': '拖动以调整大小。双击恢复默认大小。',
  'review.openInEditor': '在编辑器中打开',
  'review.copy': '复制差异',
  'review.copied': '已复制',
  'review.showUnchanged': '显示 {count} 行未更改内容',
  'review.hideUnchanged': '隐藏 {count} 行未更改内容',
  'review.stats': '新增 {added} 行，删除 {removed} 行',
  'review.unavailable': '无法为此更改还原可审查的差异。你仍可打开当前文件。',
}
