<div align="center">

# DSH File Review

**无需离开 DeepSeek Harness Web，即可立即审查 Agent 刚刚修改的每个文件。**

![DeepSeek Harness 0.1.x](https://img.shields.io/badge/DeepSeek%20Harness-0.1.x-4f46e5)
![Web profile](https://img.shields.io/badge/profile-Web-0ea5e9)
[![npm version](https://img.shields.io/npm/v/dsh-file-review.svg)](https://www.npmjs.com/package/dsh-file-review)
[![npm downloads](https://img.shields.io/npm/dm/dsh-file-review.svg)](https://www.npmjs.com/package/dsh-file-review)
[![GitHub repository](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/left0ver/dsh-file-review)
[![MIT License](https://img.shields.io/badge/license-MIT-22c55e)](LICENSE)

[English](README.md) · 简体中文

</div>

## 怎么用

<p align="center">
  <strong>💬 Chat &nbsp;→&nbsp; ✨ Generate &nbsp;→&nbsp; 📄 Click a changed file &nbsp;→&nbsp; 🔍 Review</strong>
</p>

## 效果预览
![leftover](./assests/preview.png)

## 功能
1. 本插件支持标准模式、PTC模式、创造模式、**暂时不支持极简模式**。
2. 可以通过`Diff`面板审查 Agent 刚刚修改的每个文件。
3. 支持撤销操作，目前支持对编辑文件、新增文件等操作进行撤销。**暂不支持对删除的文件进行撤销操作。**
    > 因为目前dsh暂时没有提供删除文件的相关tool，因此本插件暂时不支持对删除的文件进行撤销操作。后续若dsh提供了删除文件的tool，本插件会进一步地支持。
4. 可对变更行添加评论，并让 Agent 根据评论内容继续修改，或者对改变更进行询问。
5. 支持对在review的时候，对长文本自动换行显示，可在“设置 → 插件 → 插件配置 → 文件审查”进行勾选，默认为False。
6. 多语言支持，包括中文和英文。
## 快速开始

### 0. 将dsh-file-review添加到pnpm冷静期白名单
找到`~/.dsh/profiles/web/pnpm-workspace.yaml`,加上

```yaml
minimumReleaseAgeExclude:
  - dsh-file-review
```
这是因为较新版的`pnpm`有冷静期，默认情况下，新发布的包得过了冷静期之后才会被安装。因此要安装最新版本，需要将`dsh-file-review`加入到名单中。
### 1. 安装插件

```sh
dsh plugin --profile web add dsh-file-review
```

### 2. 启动 DSH Web

```sh
dsh web
```

### 3. 享受它


## 从源码安装

```sh
git clone https://github.com/left0ver/dsh-file-review.git
cd dsh-file-review
pnpm install
pnpm run build
dsh plugin --profile web add ${PWD}
```

## 从GitHub仓库进行安装

```sh
dsh plugin --profile web add github:left0ver/dsh-file-review
```

## 更新插件

```sh
dsh plugin --profile web update dsh-file-review
```
## 卸载插件

```sh
dsh plugin --profile web remove dsh-file-review
```
## 路线图
- [ ] 支持对删除的文件进行撤销操作。

## 友情链接

[LINUX DO](https://linux.do/) — 新的理想型社区

## 许可证

[MIT](LICENSE)
