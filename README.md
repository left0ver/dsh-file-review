<div align="center">

# DSH File Review

**Review every file an agent just changed—without leaving DeepSeek Harness Web.**

![DeepSeek Harness 0.1.x](https://img.shields.io/badge/DeepSeek%20Harness-0.1.x-4f46e5)
![Web profile](https://img.shields.io/badge/profile-Web-0ea5e9)
[![GitHub repository](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/left0ver/dsh-file-review)
[![MIT License](https://img.shields.io/badge/license-MIT-22c55e)](LICENSE)

English · [简体中文](README.zh.md)

</div>

> **Zero configuration:** install the plugin, restart the Web profile, and use DeepSeek Harness as usual.

# How to use

<p align="center">
  <strong>💬 Chat &nbsp;→&nbsp; ✨ Generate &nbsp;→&nbsp; 📄 Click a changed file &nbsp;→&nbsp; 🔍 Review</strong>
</p>

# Preview
![leftover](./assests/preview.png)

## Quick start

### 1. Install the plugin

```sh
dsh plugin --profile web add dsh-file-review
```

### 2. Start DSH Web

```sh
dsh web
```

### 3. Review the next completed turn

Ask the agent to create or edit files. When the turn finishes:

1. Find the produced-file chips below the final response.
2. Click a file to open its diff.
3. Inspect the changes, expand hidden context, copy the diff, or open the file in your editor.

```text
Agent edits files  →  Turn completes  →  Click a file chip  →  Review the diff
```

To uninstall:

```sh
dsh plugin --profile web remove dsh-file-review
```

## Install from a local checkout

From the repository root:

```sh
git clone https://github.com/left0ver/dsh-file-review.git
cd dsh-file-review
pnpm install
pnpm run build
dsh plugin --profile web add ${PWD}
```

## License

[MIT](LICENSE)
