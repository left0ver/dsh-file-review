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
  'review.unavailable': 'No reconstructable diff is available for this change. You can still open the current file.',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof en

/** Keep the plugin copy in English when the host locale is Simplified Chinese. */
export const zh: Record<DeliverablesKey, string> = en
