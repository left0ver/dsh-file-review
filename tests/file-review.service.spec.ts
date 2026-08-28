import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
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
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-review-'))
  roots.push(root)
  return root
}

function fakeAgent(cwd: string): Agent {
  return {
    session: { header: { cwd } },
    runMaintenance: async (task) => task(new AbortController().signal),
  } as Agent
}

function change(path: string, oldText: string | null, newText: string): FileReviewChange {
  return { path, diffs: [{ path, oldText, newText }] }
}

async function status(agent: Agent, request: FileReviewRequest) {
  return FileReviewService.prototype.status.call({} as FileReviewService, agent, request)
}

async function applyChange(agent: Agent, request: FileReviewRequest) {
  return FileReviewService.prototype.apply.call({} as FileReviewService, agent, request)
}

describe('Host file-review change engine', () => {
  it('undoes and reapplies a created UTF-8 file', async () => {
    const root = await workspace()
    const filename = join(root, 'created.txt')
    await writeFile(filename, 'created\n', { mode: 0o640 })
    const agent = fakeAgent(root)
    const request: FileReviewRequest = {
      action: 'undo',
      files: [
        {
          path: 'created.txt',
          diffs: [
            {
              path: 'created.txt',
              oldText: null,
              newText: 'created\n',
              oldStart: 1,
              newStart: 1,
              lifecycle: { kind: 'create', mode: 0o640 },
            },
          ],
        },
      ],
    }

    expect(await status(agent, request)).toEqual({
      files: [{ path: 'created.txt', state: 'applied', changed: false }],
    })
    expect(await applyChange(agent, request)).toEqual({
      files: [{ path: 'created.txt', state: 'undone', changed: true }],
    })
    await expect(access(filename)).rejects.toThrow()
    expect(await applyChange(agent, request)).toEqual({
      files: [{ path: 'created.txt', state: 'undone', changed: false }],
    })

    expect(await applyChange(agent, { ...request, action: 'redo' })).toEqual({
      files: [{ path: 'created.txt', state: 'applied', changed: true }],
    })
    expect(await readFile(filename, 'utf8')).toBe('created\n')
    expect((await lstat(filename)).mode & 0o777).toBe(0o640)
  })

  it('supports empty lifecycle files and treats permission drift as a conflict', async () => {
    const root = await workspace()
    const empty = join(root, 'empty.txt')
    const drifted = join(root, 'drifted.txt')
    await writeFile(empty, '', { mode: 0o600 })
    await writeFile(drifted, 'content', { mode: 0o600 })
    const agent = fakeAgent(root)
    const emptyCreate: FileReviewChange = {
      path: 'empty.txt',
      diffs: [
        {
          path: 'empty.txt',
          oldText: null,
          newText: '',
          lifecycle: { kind: 'create', mode: 0o600 },
        },
      ],
    }
    const driftedCreate: FileReviewChange = {
      path: 'drifted.txt',
      diffs: [
        {
          path: 'drifted.txt',
          oldText: null,
          newText: 'content',
          lifecycle: { kind: 'create', mode: 0o640 },
        },
      ],
    }
    const emptyDelete: FileReviewChange = {
      path: 'empty-deleted.txt',
      diffs: [
        {
          path: 'empty-deleted.txt',
          oldText: '',
          newText: '',
          lifecycle: { kind: 'delete', mode: 0o666 },
        },
      ],
    }

    expect((await applyChange(agent, { action: 'undo', files: [emptyCreate] })).files[0]).toEqual({
      path: 'empty.txt',
      state: 'undone',
      changed: true,
    })
    await expect(access(empty)).rejects.toThrow()
    expect((await applyChange(agent, { action: 'redo', files: [emptyCreate] })).files[0]).toEqual({
      path: 'empty.txt',
      state: 'applied',
      changed: true,
    })
    expect(await readFile(empty, 'utf8')).toBe('')
    expect((await applyChange(agent, { action: 'undo', files: [driftedCreate] })).files[0]).toEqual(
      expect.objectContaining({ state: 'conflict', changed: false }),
    )
    expect(await readFile(drifted, 'utf8')).toBe('content')
    expect((await applyChange(agent, { action: 'undo', files: [emptyDelete] })).files[0]).toEqual({
      path: 'empty-deleted.txt',
      state: 'undone',
      changed: true,
    })
    expect(await readFile(join(root, 'empty-deleted.txt'), 'utf8')).toBe('')
    expect((await lstat(join(root, 'empty-deleted.txt'))).mode & 0o777).toBe(0o666)
  })

  it('undoes and reapplies a deleted UTF-8 file', async () => {
    const root = await workspace()
    const filename = join(root, 'deleted.txt')
    const agent = fakeAgent(root)
    const request: FileReviewRequest = {
      action: 'undo',
      files: [
        {
          path: 'deleted.txt',
          diffs: [
            {
              path: 'deleted.txt',
              oldText: 'deleted\n',
              newText: '',
              oldStart: 1,
              newStart: 1,
              lifecycle: { kind: 'delete', mode: 0o600 },
            },
          ],
        },
      ],
    }

    expect(await applyChange(agent, request)).toEqual({
      files: [{ path: 'deleted.txt', state: 'undone', changed: true }],
    })
    expect(await readFile(filename, 'utf8')).toBe('deleted\n')
    expect((await lstat(filename)).mode & 0o777).toBe(0o600)

    expect(await applyChange(agent, { ...request, action: 'redo' })).toEqual({
      files: [{ path: 'deleted.txt', state: 'applied', changed: true }],
    })
    await expect(access(filename)).rejects.toThrow()
  })

  it('transforms combined lifecycle and text changes as one file state', async () => {
    const root = await workspace()
    await writeFile(join(root, 'created-edited.txt'), 'B', { mode: 0o640 })
    await writeFile(join(root, 'replaced.txt'), 'new')
    await chmod(join(root, 'replaced.txt'), 0o666)
    const request: FileReviewRequest = {
      action: 'undo',
      files: [
        {
          path: 'created-edited.txt',
          diffs: [
            {
              path: 'created-edited.txt',
              oldText: null,
              newText: 'A',
              lifecycle: { kind: 'create', mode: 0o640 },
            },
            { path: 'created-edited.txt', oldText: 'A', newText: 'B' },
          ],
        },
        {
          path: 'edited-deleted.txt',
          diffs: [
            { path: 'edited-deleted.txt', oldText: 'old', newText: 'edited' },
            {
              path: 'edited-deleted.txt',
              oldText: 'edited',
              newText: '',
              lifecycle: { kind: 'delete', mode: 0o644 },
            },
          ],
        },
        {
          path: 'replaced.txt',
          diffs: [
            {
              path: 'replaced.txt',
              oldText: 'old',
              newText: '',
              lifecycle: { kind: 'delete', mode: 0o644 },
            },
            {
              path: 'replaced.txt',
              oldText: null,
              newText: 'new',
              lifecycle: { kind: 'create', mode: 0o666 },
            },
          ],
        },
        {
          path: 'created-deleted.txt',
          diffs: [
            {
              path: 'created-deleted.txt',
              oldText: null,
              newText: 'temporary',
              lifecycle: { kind: 'create', mode: 0o644 },
            },
            {
              path: 'created-deleted.txt',
              oldText: 'temporary',
              newText: '',
              lifecycle: { kind: 'delete', mode: 0o644 },
            },
          ],
        },
      ],
    }

    const undone = await applyChange(fakeAgent(root), request)
    expect(undone.files.map((file) => [file.path, file.state, file.changed])).toEqual([
      ['created-edited.txt', 'undone', true],
      ['edited-deleted.txt', 'undone', true],
      ['replaced.txt', 'undone', true],
      ['created-deleted.txt', 'undone', false],
    ])
    await expect(access(join(root, 'created-edited.txt'))).rejects.toThrow()
    expect(await readFile(join(root, 'edited-deleted.txt'), 'utf8')).toBe('old')
    expect(await readFile(join(root, 'replaced.txt'), 'utf8')).toBe('old')
    await expect(access(join(root, 'created-deleted.txt'))).rejects.toThrow()

    const redone = await applyChange(fakeAgent(root), { ...request, action: 'redo' })
    expect(redone.files.map((file) => [file.path, file.state, file.changed])).toEqual([
      ['created-edited.txt', 'applied', true],
      ['edited-deleted.txt', 'applied', true],
      ['replaced.txt', 'applied', true],
      ['created-deleted.txt', 'applied', false],
    ])
    expect(await readFile(join(root, 'created-edited.txt'), 'utf8')).toBe('B')
    await expect(access(join(root, 'edited-deleted.txt'))).rejects.toThrow()
    expect(await readFile(join(root, 'replaced.txt'), 'utf8')).toBe('new')
    expect((await lstat(join(root, 'replaced.txt'))).mode & 0o777).toBe(0o666)
  })

  it('never removes or overwrites lifecycle paths changed after the recorded operation', async () => {
    const root = await workspace()
    await writeFile(join(root, 'created.txt'), 'user edit', { mode: 0o640 })
    await writeFile(join(root, 'deleted.txt'), 'replacement', { mode: 0o600 })
    const agent = fakeAgent(root)
    const create = {
      path: 'created.txt',
      diffs: [
        {
          path: 'created.txt',
          oldText: null,
          newText: 'agent content',
          lifecycle: { kind: 'create' as const, mode: 0o640 },
        },
      ],
    }
    const deletion = {
      path: 'deleted.txt',
      diffs: [
        {
          path: 'deleted.txt',
          oldText: 'deleted content',
          newText: '',
          lifecycle: { kind: 'delete' as const, mode: 0o600 },
        },
      ],
    }

    const result = await applyChange(agent, {
      action: 'undo',
      files: [create, deletion],
    })
    expect(result.files).toEqual([
      expect.objectContaining({ path: 'created.txt', state: 'conflict', changed: false }),
      expect.objectContaining({ path: 'deleted.txt', state: 'conflict', changed: false }),
    ])
    expect(await readFile(join(root, 'created.txt'), 'utf8')).toBe('user edit')
    expect(await readFile(join(root, 'deleted.txt'), 'utf8')).toBe('replacement')

    await rm(join(root, 'deleted.txt'))
    expect((await applyChange(agent, { action: 'undo', files: [deletion] })).files[0]).toEqual({
      path: 'deleted.txt',
      state: 'undone',
      changed: true,
    })
    await writeFile(join(root, 'deleted.txt'), 'edited after restore')
    expect((await applyChange(agent, { action: 'redo', files: [deletion] })).files[0]).toEqual(
      expect.objectContaining({ path: 'deleted.txt', state: 'conflict', changed: false }),
    )
    expect(await readFile(join(root, 'deleted.txt'), 'utf8')).toBe('edited after restore')
  })

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
    await writeFile(join(root, 'incomplete.txt'), 'new')
    const result = await status(fakeAgent(root), {
      action: 'undo',
      files: [
        change('applied.txt', 'old', 'new'),
        change('undone.txt', 'old', 'new'),
        change('conflict.txt', 'old', 'new'),
        change('unknown.txt', null, 'new'),
        { ...change('incomplete.txt', 'old', 'new'), complete: false },
      ],
    })
    expect(result.files.map((file) => file.state)).toEqual([
      'applied',
      'undone',
      'conflict',
      'unsupported',
      'unsupported',
    ])
  })

  it('rejects paths outside the workspace and symbolic links', async () => {
    const root = await workspace()
    await writeFile(join(root, 'target.txt'), 'new')
    await symlink(join(root, 'target.txt'), join(root, 'link.txt'))
    await mkdir(join(root, 'folder'))
    const lifecycle = (path: string): FileReviewChange => ({
      path,
      diffs: [
        {
          path,
          oldText: 'old',
          newText: '',
          lifecycle: { kind: 'delete', mode: 0o644 },
        },
      ],
    })
    const result = await status(fakeAgent(root), {
      action: 'undo',
      files: [
        change('/etc/hosts', 'old', 'new'),
        lifecycle('link.txt'),
        lifecycle('folder'),
        lifecycle('missing-parent/file.txt'),
      ],
    })
    expect(result.files).toEqual([
      expect.objectContaining({ state: 'error', reason: 'path is outside the session workspace' }),
      expect.objectContaining({ state: 'error', reason: 'symbolic links are not supported' }),
      expect.objectContaining({ state: 'error', reason: 'path is not a regular file' }),
      expect.objectContaining({ state: 'error' }),
    ])
  })

  it('preserves file permissions across atomic replacement', async () => {
    const root = await workspace()
    const filename = join(root, 'script.sh')
    await writeFile(filename, 'NEW')
    await chmod(filename, 0o640)
    await applyChange(fakeAgent(root), {
      action: 'undo',
      files: [change('script.sh', 'OLD', 'NEW')],
    })
    expect(await readFile(filename, 'utf8')).toBe('OLD')
    expect((await lstat(filename)).mode & 0o777).toBe(0o640)
  })

  it('reports non-UTF-8 files and rejects sessions without a workspace', async () => {
    const root = await workspace()
    await writeFile(join(root, 'binary.txt'), new Uint8Array([0xff, 0xfe]))
    const result = await status(fakeAgent(root), {
      action: 'undo',
      files: [change('binary.txt', 'old', 'new')],
    })
    expect(result.files[0]).toEqual(
      expect.objectContaining({
        state: 'error',
        reason: 'file is not valid UTF-8 text',
      }),
    )
    await expect(
      status(fakeAgent(''), {
        action: 'undo',
        files: [change('a.txt', 'old', 'new')],
      }),
    ).rejects.toThrow('session has no workspace directory')
  })

  it('does not enter file mutation while the Agent is busy', async () => {
    const root = await workspace()
    await writeFile(join(root, 'a.txt'), 'new')
    const agent = {
      session: { header: { cwd: root } },
      runMaintenance: () => {
        throw new Error('agent is busy')
      },
    } as unknown as Agent
    await expect(
      applyChange(agent, {
        action: 'undo',
        files: [change('a.txt', 'old', 'new')],
      }),
    ).rejects.toThrow('agent is busy')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('new')
  })

  it('publishes matching strict Host and client Remote descriptors', () => {
    expect(TYPERT.invocations.map((item) => item.method)).toEqual(['status', 'apply'])
    expect(TYPERT_REMOTE.descriptors).toEqual(TYPERT.invocations)
    expect(TYPERT.invocations.every((item) => item.scope?.context === 'agent')).toBe(true)
  })
})
