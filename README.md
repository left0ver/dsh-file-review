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

1. A diff panel for instantly reviewing every file the agent just changed.
2. Undo support for reverting the agent's changes from the current turn.
3. Comment on changed lines and ask the agent to update the code based on the feedback.
4. Multilingual support, including Chinese and English.

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

## Friendly Links

[LINUX DO](https://linux.do/) — A new ideal community

## License

[MIT](LICENSE)
