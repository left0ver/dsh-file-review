dsh-file-review

English | [中文](README.zh.md)

An installable DeepSeek Harness Web plugin that turns the files produced by a completed agent turn into review buttons. Selecting a file opens an in-page modal with a line-numbered unified diff, expandable unchanged ranges, per-file addition and deletion totals, a copy action, and an optional **Open in editor** action.

The package is self-contained: it owns the turn accumulator, review modal, diff algorithm, CSS Modules compiler configuration, browser bundle, and profile patch. It uses published Harness plugin APIs through peer dependencies and never imports source files or build presets from the deepseek-harness repository.

## Features

- **Produced-files row** — a finished turn ends with one-line chips for every file it wrote, deduplicated in first-seen order; overflow collapses into a localized `+N files` remainder that re-measures on resize.
- **Line-numbered unified diff** — old/new gutters, change signs, and 3 context lines per hunk; absolute source line numbers survive when the result view provides `oldStart`/`newStart`.
- **Expandable unchanged ranges** — collapsed context re-expands inline, and the header reports the omitted count when hunks skip unchanged lines between edits.
- **Per-file totals** — each file header shows its `M` status plus cumulative `+added` and `-removed` totals across all applied hunks.
- **Copy the diff** — one click copies a plain unified-diff text of every recorded hunk.
- **Clickable prose mentions** — inline-code file references in the closing message become links to the same review targets.
- **Open in editor** — relative paths open through the chat view's `openFile` capability; **Show in folder** appears when the browser is loopback-connected and the Host supports native path opening.
- **Bilingual UI** — Simplified Chinese and English dictionaries that follow the Web UI locale.

## Requirements

- DeepSeek Harness `0.1.x` with the **Web** profile.
- Harness packages and React are peer dependencies resolved from the profile's shared runtime; `diff` is the only dependency this package bundles itself.

## Install

Install the published package into the Web profile:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-file-review
```

Restart the Web profile after installation — the launcher loads plugin bundles at boot. To remove the plugin:

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-file-review
```

For a local checkout, install its dependencies and run `npm run build` before replacing the package name in the `add` command with `./plugins/dsh-file-review`. A packed tarball can be installed directly from its `.tgz` path.

## How it works

The plugin is one package with two halves, discovered through the `package.json` `dsh.client` declaration:

- **Node half** (`src/index.ts`) registers a fixed system-prompt section asking the model to mention changed files as Markdown inline code — the exact file-tool path, or a basename when unique among the files changed in that turn. This guidance is what makes review targets clickable in prose.
- **Browser half** (`src/client/index.ts`) registers a turn-scoped `deliverables` accumulator, the produced-files row in the chat view's turn-tail chain, the `file-review` locale dictionaries, and a `chatFileMentions` service that links inline-code mentions in the closing prose.

A file counts as produced from the mutation tools' own follow-along `locations`, never from the closing prose — a produced file is listed whether or not the model remembered to name it. A mutation is recognized by render intent (a diff card, or a generic edit card), not by tool name, so reads, deletions, failed calls, and terminal-created files without a mutation location contribute nothing, and nested Code Mode dispatches do not double-count.

## Review UI

Clicking a chip opens the review modal for that file:

- **Line numbers** — hunks carry `oldStart`/`newStart` when the result view provides them, preserving absolute source line numbers; otherwise each recorded hunk starts at line 1, with content order and added or removed text remaining exact.
- **Hunk rendering** — 3 context lines per hunk, unchanged runs collapsed into an expandable gap, and a per-file header with `M`, `+added`, and `-removed` totals.
- **Unavailable state** — a mutation that reports a file location without reconstructable diff text shows an explicit unavailable message; the file can still be opened from the modal.
- **Actions** — **Close**, **Open in editor** (through the chat view's `openFile`), and **Copy**. **Show in folder** appears only when some chips overflowed, the browser is connected over loopback, and the current Host reports native path opening support.

## Package contract

The package exports a Node plugin at `@deepseek-ai/dsh-file-review` and a browser plugin at `@deepseek-ai/dsh-file-review/client`; the browser artifact registers itself through the Harness module loader. The `dsh.bundle` manifest entry points to `cordis.patch.yml`, and consumers should install the bundle rather than adding its Cordis row manually. Harness packages and React are peers, so the Host and browser retain their shared runtime identities; `diff` is the only bundled runtime dependency. CSS Modules compile into self-injected `<style>` elements at runtime, so the tarball ships no separate stylesheet.

## Development and publication

Development requires pnpm and a Node.js version inside tsdown's engine range (`^22.18.0 || >=24.11.0`). Install the manifest dependencies in this directory, then run:

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack --dry-run
```

`pnpm test` builds the package, runs the Vitest suites (node-half prompt registration, browser-half derivation and rendering, and the published-bundle handoff), and verifies the npm tarball contents. `prepack` repeats type checking, tests, and the build. The npm tarball contains prebuilt `lib/index.js`, `lib/client.js`, declarations, source maps, the profile patch, and both READMEs; it does not require the deepseek-harness source tree at installation time.

## Troubleshooting

| Symptom | Explanation |
| --- | --- |
| No produced-files row after a turn | The turn's successful mutation tool results reported no `locations`, or the file was written by a terminal command with no mutation location. |
| Modal reports no reconstructable diff | The result view carried the location but no rebuildable hunk text — common for large overwrites. Open the file from the modal instead. |
| A prose mention is not clickable | The token is neither an exact produced path nor the unique basename of one; ambiguous basenames stay inert by design. |
| No **Show in folder** button | Requires chip overflow plus a loopback connection and a Host that reports native path opening. |
| Plugin not active after install | Restart the Web profile; plugin bundles are loaded at boot. |

## Limitations

- Review reflects the recorded mutation sequence, not an initial-to-final workspace comparison and not later user edits.
- Exact paths and unique basenames become clickable; ambiguous basenames stay inert.
- Large overwrite results may omit the previous text, so some successful mutations cannot show a complete two-sided diff.
- The package targets the DeepSeek Harness `0.1.x` client plugin protocol. Its peer dependency range rejects incompatible future protocol releases.

## License

Released under the MIT License.
