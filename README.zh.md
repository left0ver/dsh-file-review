<div align="center">

# DSH File Review

**无需离开 DeepSeek Harness Web，立即审查 Agent 刚刚修改的每个文件。**

![DeepSeek Harness 0.1.x](https://img.shields.io/badge/DeepSeek%20Harness-0.1.x-4f46e5)
![Web profile](https://img.shields.io/badge/profile-Web-0ea5e9)
[![GitHub repository](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/left0ver/dsh-file-review)
[![MIT License](https://img.shields.io/badge/license-MIT-22c55e)](LICENSE)

[English](README.md) · 简体中文

</div>



> **零配置：**安装插件、重启 Web profile，然后像平时一样使用 DeepSeek Harness 即可。

# 怎么用

<p align="center">
  <strong>💬 Chat &nbsp;→&nbsp; ✨ Generate &nbsp;→&nbsp; 📄 Click a changed file &nbsp;→&nbsp; 🔍 Review</strong>
</p>

# 效果预览
![leftover](./assests/preview.png)

## 快速开始

### 1. 安装插件

```sh
dsh plugin --profile web add dsh-file-review
```

### 2. 启动 DSH Web

```sh
dsh web
```

### 3. 审查下一轮产出

让 Agent 创建或修改文件。本轮任务结束后：

1. 在最终回复下方找到产物文件标签。
2. 点击文件，打开对应 diff。
3. 检查修改、展开隐藏上下文、复制 diff，或在编辑器中打开文件。

```text
Agent 修改文件  →  本轮任务完成  →  点击文件标签  →  审查差异
```

## 从源码安装

```sh
git clone https://github.com/left0ver/dsh-file-review.git
cd dsh-file-review
pnpm install
pnpm run build
dsh plugin --profile web add ${PWD}
```

## 卸载插件

```sh
dsh plugin --profile web remove dsh-file-review
```

## 友情链接

[LINUX DO](https://linux.do/) — 新的理想型社区
## 许可证

[MIT](LICENSE)
