/**
 * Split one side of a diff into content lines without manufacturing a final
 * empty line for a trailing line terminator.
 * @param text - One diff side's text.
 * @returns Content lines without the terminating newline.
 */
export function diffContentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}
