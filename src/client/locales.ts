/** `file-review` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'file-review'

/** English dictionary (the key-set source of truth). */
export const en = {
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
export type DeliverablesKey = keyof typeof en

/** Keep the plugin copy in English when the host locale is Simplified Chinese. */
export const zh: Record<DeliverablesKey, string> = en
