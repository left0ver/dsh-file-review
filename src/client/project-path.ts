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
  return comparablePath.startsWith(prefix)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : path
}
