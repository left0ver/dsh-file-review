/** Keep host paths intact for actions while presenting files relative to their project. */
export function displayProjectPath(path: string, projectRoot: string | undefined): string {
  if (projectRoot === undefined || projectRoot.length === 0) return path
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedRoot = projectRoot.replaceAll('\\', '/').replace(/\/+$/, '')
  if (normalizedRoot.length === 0) return path
  const windowsPath = /^[A-Za-z]:\//.test(normalizedPath)
  const comparablePath = windowsPath ? normalizedPath.toLowerCase() : normalizedPath
  const comparableRoot = windowsPath ? normalizedRoot.toLowerCase() : normalizedRoot
  const prefix = `${comparableRoot}/`
  return comparablePath.startsWith(prefix) ? normalizedPath.slice(normalizedRoot.length + 1) : path
}

/**
 * Compute minimal trailing directory suffixes (VS Code tab style) when two or more
 * paths share the same filename, keeping unique basenames clutter-free.
 */
export function disambiguateDirectories(paths: readonly string[]): ReadonlyMap<string, string> {
  const byName = new Map<
    string,
    Array<{ readonly raw: string; readonly dirs: readonly string[] }>
  >()
  for (const raw of paths) {
    const normalized = raw.replaceAll('\\', '/').replace(/\/+$/, '')
    const parts = normalized.split('/').filter((segment) => segment.length > 0)
    const name = parts.at(-1) ?? raw
    const dirs = parts.slice(0, -1)
    const bucket = byName.get(name)
    if (bucket !== undefined) bucket.push({ raw, dirs })
    else byName.set(name, [{ raw, dirs }])
  }

  const hints = new Map<string, string>()
  for (const group of byName.values()) {
    if (group.length < 2) continue
    const maxDepth = Math.max(1, ...group.map((entry) => entry.dirs.length))
    let chosenDepth = maxDepth
    for (let depth = 1; depth <= maxDepth; depth++) {
      const labels = new Set(
        group.map((entry) => (entry.dirs.length === 0 ? './' : entry.dirs.slice(-depth).join('/'))),
      )
      if (labels.size === group.length) {
        chosenDepth = depth
        break
      }
    }
    for (const entry of group) {
      hints.set(
        entry.raw,
        entry.dirs.length === 0 ? './' : entry.dirs.slice(-chosenDepth).join('/'),
      )
    }
  }
  return hints
}
