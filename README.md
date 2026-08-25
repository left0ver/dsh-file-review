<div align="center">

# DSH File Review

**Review every file an agent just changed—without leaving DeepSeek Harness Web.**

![DeepSeek Harness 0.1.x](https://img.shields.io/badge/DeepSeek%20Harness-0.1.x-4f46e5)
![Web profile](https://img.shields.io/badge/profile-Web-0ea5e9)
[![npm version](https://img.shields.io/npm/v/dsh-file-review.svg)](https://www.npmjs.com/package/dsh-file-review)
[![GitHub repository](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/left0ver/dsh-file-review)
[![MIT License](https://img.shields.io/badge/license-MIT-22c55e)](LICENSE)

English · [简体中文](README.zh.md)

</div>

## How to use

<p align="center">
  <strong>💬 Chat &nbsp;→&nbsp; ✨ Generate &nbsp;→&nbsp; 📄 Click a changed file &nbsp;→&nbsp; 🔍 Review</strong>
</p>

## Preview

![leftover](./assests/preview.png)

## Features

1. Review every file the agent just changed in the `Diff` panel, with support for both standard mode and PTC mode.
2. Undo support is currently available in standard, PTC, and Creator modes for text edits and newly created files performed by the agent.
   > DSH does not currently provide a file-deletion tool, so this plugin cannot yet undo deleted files. Support will be added once DSH provides such a tool.
3. Add comments to changed lines and ask the agent to continue making updates based on the feedback, or ask questions about the changes.
4. Optionally wrap long diff lines under Settings → Plugins → Plugin configuration → File review. Wrapping changes only the presentation; copied text and line identity stay unchanged. The default is off.
5. Multilingual support, including Chinese and English.

## Quick start

### 0. Add dsh-file-review in pnpm's minimum release age withlist

Open `~/.dsh/profiles/web/pnpm-workspace.yaml` and add:

```yaml
minimumReleaseAgeExclude:
  - dsh-file-review
```

Recent versions of `pnpm` enforce a minimum release age, so newly published packages are not installed until that waiting period has passed. To install the latest version, add `dsh-file-review` to the exclusion list.

### 1. Install the plugin

```sh
dsh plugin --profile web add dsh-file-review
```

### 2. Start DSH Web

```sh
dsh web
```

### 3. Enjoy it

## Install from source

```sh
git clone https://github.com/left0ver/dsh-file-review.git
cd dsh-file-review
pnpm install
pnpm run build
dsh plugin --profile web add ${PWD}
```

## Install from GitHub repository

```sh
dsh plugin --profile web add github:left0ver/dsh-file-review
```

## Update the plugin

```sh
dsh plugin --profile web update dsh-file-review
```

## Uninstall the plugin

```sh
dsh plugin --profile web remove dsh-file-review
```

## Roadmap

- [ ] Add undo support for deleted files.

## Friendly Links

[LINUX DO](https://linux.do/) — A new ideal community

## License

[MIT](LICENSE)
