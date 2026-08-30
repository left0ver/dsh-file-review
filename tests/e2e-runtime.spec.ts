import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dshInvocation, seedRuntimeState } from '../e2e/dsh-runtime.mjs'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('E2E DSH runtime', () => {
  it('seeds the current checkout for a fresh DSH home', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dsh-file-review-e2e-'))
    temporaryRoots.push(root)
    const dshHome = path.join(root, '.e2e', 'dsh-home-standalone')
    const now = new Date('2026-08-30T06:46:20.123Z')

    seedRuntimeState({ dshHome, root, now })

    const settings = readFileSync(path.join(dshHome, 'settings.yaml'), 'utf8')
    expect(settings).not.toContain('welcomeNoticeVersion')
    expect(settings).toContain('wordWrap: false')

    const workspace = JSON.parse(
      readFileSync(path.join(dshHome, 'storages', 'workspace.json'), 'utf8'),
    )
    const workspaceId = workspace.global.workspaceIds[0]
    expect(workspace.global).toMatchObject({ initialized: true, archivedSessionIds: [] })
    expect(workspace.tables.workspaces[workspaceId]).toMatchObject({
      path: root,
      title: path.basename(root),
      sessionIds: [],
      createdAt: '2026-08-30T14:46:20.123+08:00',
      updatedAt: '2026-08-30T14:46:20.123+08:00',
    })
  })

  it('runs npm command shims through cmd.exe on Windows', () => {
    expect(
      dshInvocation(['plugin', '--profile', 'web'], {
        platform: 'win32',
        comSpec: 'C:\\Windows\\System32\\cmd.exe',
      }),
    ).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/c', 'dsh.cmd', 'plugin', '--profile', 'web'],
    })
  })

  it('runs the DSH executable directly on macOS and Linux', () => {
    expect(dshInvocation(['web'], { platform: 'darwin' })).toEqual({
      command: 'dsh',
      args: ['web'],
    })
    expect(dshInvocation(['web'], { platform: 'linux' })).toEqual({
      command: 'dsh',
      args: ['web'],
    })
  })
})
