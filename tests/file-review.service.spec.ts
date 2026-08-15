import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileReviewChange, FileReviewRequest } from '../src/change-types.ts'
import { FileReviewService, transformFile } from '../src/file-review-service.ts'
import { TYPERT } from '../src/typert.host.ts'
import { TYPERT_REMOTE } from '../src/remote.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-review-'))
  roots.push(root)
  return root
}

function fakeAgent(cwd: string): Agent {
  return {
    session: { header: { cwd } },
    runMaintenance: async task => task(new AbortController().signal),
  } as Agent
}

function change(path: string, oldText: string | null, newText: string): FileReviewChange {
  return { path, diffs: [{ path, oldText, newText }] }
}

async function status(
  agent: Agent,
  request: FileReviewRequest,
) {
  return FileReviewService.prototype.status.call({} as FileReviewService, agent, request)
}

async function applyChange(
  agent: Agent,
  request: FileReviewRequest,
) {
  return FileReviewService.prototype.apply.call({} as FileReviewService, agent, request)
}

describe('Host file-review change engine', () => {
  it('applies multi-hunk files forward and backward in the required order', () => {
    const file: FileReviewChange = {
      path: 'notes.txt',
      diffs: [
        { path: 'notes.txt', oldText: 'b', newText: 'B', oldStart: 2, newStart: 2 },
        { path: 'notes.txt', oldText: 'c', newText: 'C', oldStart: 3, newStart: 3 },
      ],
    }
    expect(transformFile('a\nb\nc\n', file, 'redo')).toBe('a\nB\nC\n')
    expect(transformFile('a\nB\nC\n', file, 'undo')).toBe('a\nb\nc\n')
  })

  it('uses a unique exact occurrence without positions and rejects ambiguity', () => {
    const file = change('notes.txt', 'before', 'after')
    expect(transformFile('x before y', file, 'redo')).toBe('x after y')
    expect(transformFile('before before', file, 'redo')).toBeNull()
  })

  it('changes safe files independently while skipping conflicts and unsupported diffs', async () => {
    const root = await workspace()
    await writeFile(join(root, 'a.txt'), 'A')
    await writeFile(join(root, 'b.txt'), 'someone else changed this')
    await writeFile(join(root, 'created.txt'), 'new')
    const agent = fakeAgent(root)
    const request: FileReviewRequest = {
      action: 'undo',
      files: [
        change('a.txt', 'a', 'A'),
        change('b.txt', 'b', 'B'),
        change('created.txt', null, 'new'),
      ],
    }

    const result = await applyChange(agent, request)
    expect(result.files).toEqual([
      { path: 'a.txt', state: 'undone', changed: true },
      expect.objectContaining({ path: 'b.txt', state: 'conflict', changed: false }),
      expect.objectContaining({ path: 'created.txt', state: 'unsupported', changed: false }),
    ])
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('a')
    expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('someone else changed this')

    const redone = await applyChange(agent, { ...request, action: 'redo' })
    expect(redone.files[0]).toEqual({ path: 'a.txt', state: 'applied', changed: true })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('A')
  })

  it('derives applied, undone, conflict, and unsupported status from disk', async () => {
    const root = await workspace()
    await writeFile(join(root, 'applied.txt'), 'new')
    await writeFile(join(root, 'undone.txt'), 'old')
    await writeFile(join(root, 'conflict.txt'), 'other')
    await writeFile(join(root, 'unknown.txt'), 'new')
    const result = await status(fakeAgent(root), {
      action: 'undo',
      files: [
        change('applied.txt', 'old', 'new'),
        change('undone.txt', 'old', 'new'),
        change('conflict.txt', 'old', 'new'),
        change('unknown.txt', null, 'new'),
      ],
    })
    expect(result.files.map(file => file.state))
      .toEqual(['applied', 'undone', 'conflict', 'unsupported'])
  })

  it('rejects paths outside the workspace and symbolic links', async () => {
    const root = await workspace()
    await writeFile(join(root, 'target.txt'), 'new')
    await symlink(join(root, 'target.txt'), join(root, 'link.txt'))
    const result = await status(fakeAgent(root), {
      action: 'undo',
      files: [change('/etc/hosts', 'old', 'new'), change('link.txt', 'old', 'new')],
    })
    expect(result.files).toEqual([
      expect.objectContaining({ state: 'error', reason: 'path is outside the session workspace' }),
      expect.objectContaining({ state: 'error', reason: 'symbolic links are not supported' }),
    ])
  })

  it('preserves file permissions across atomic replacement', async () => {
    const root = await workspace()
    const filename = join(root, 'script.sh')
    await writeFile(filename, 'NEW')
    await chmod(filename, 0o640)
    await applyChange(fakeAgent(root), {
      action: 'undo', files: [change('script.sh', 'OLD', 'NEW')],
    })
    expect(await readFile(filename, 'utf8')).toBe('OLD')
    expect((await lstat(filename)).mode & 0o777).toBe(0o640)
  })

  it('reports non-UTF-8 files and rejects sessions without a workspace', async () => {
    const root = await workspace()
    await writeFile(join(root, 'binary.txt'), new Uint8Array([0xff, 0xfe]))
    const result = await status(fakeAgent(root), {
      action: 'undo', files: [change('binary.txt', 'old', 'new')],
    })
    expect(result.files[0]).toEqual(expect.objectContaining({
      state: 'error', reason: 'file is not valid UTF-8 text',
    }))
    await expect(status(fakeAgent(''), {
      action: 'undo', files: [change('a.txt', 'old', 'new')],
    })).rejects.toThrow('session has no workspace directory')
  })

  it('does not enter file mutation while the Agent is busy', async () => {
    const root = await workspace()
    await writeFile(join(root, 'a.txt'), 'new')
    const agent = {
      session: { header: { cwd: root } },
      runMaintenance: () => { throw new Error('agent is busy') },
    } as unknown as Agent
    await expect(applyChange(agent, {
      action: 'undo', files: [change('a.txt', 'old', 'new')],
    })).rejects.toThrow('agent is busy')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('new')
  })

  it('publishes matching strict Host and client Remote descriptors', () => {
    expect(TYPERT.invocations.map(item => item.method)).toEqual(['status', 'apply'])
    expect(TYPERT_REMOTE.descriptors).toEqual(TYPERT.invocations)
    expect(TYPERT.invocations.every(item => item.scope?.context === 'agent')).toBe(true)
  })
})
