import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const E2E_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const BEIJING_TIME_OFFSET_MS = 8 * 60 * 60 * 1_000

function beijingTimestamp(date) {
  return new Date(date.getTime() + BEIJING_TIME_OFFSET_MS).toISOString().replace(/Z$/, '+08:00')
}

/** Seed only non-secret state required to reach the composer in a fresh checkout. */
export function seedRuntimeState({ dshHome, root, now = new Date() }) {
  const storageDir = path.join(dshHome, 'storages')
  const stateTimestamp = beijingTimestamp(now)
  mkdirSync(storageDir, { recursive: true })

  writeFileSync(path.join(dshHome, 'settings.yaml'), 'file-review:\n  wordWrap: false\n')

  const workspace = {
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      workspaceIds: [E2E_WORKSPACE_ID],
      archivedSessionIds: [],
    },
    tables: {
      workspaces: {
        [E2E_WORKSPACE_ID]: {
          path: root,
          title: path.basename(root),
          sessionIds: [],
          createdAt: stateTimestamp,
          updatedAt: stateTimestamp,
        },
      },
    },
  }
  writeFileSync(path.join(storageDir, 'workspace.json'), `${JSON.stringify(workspace, null, 2)}\n`)
}

/** Resolve npm's Windows command shim without involving a shell on Unix-like runners. */
export function dshInvocation(args, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') return { command: 'dsh', args: [...args] }

  return {
    command: options.comSpec ?? process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/c', 'dsh.cmd', ...args],
  }
}
