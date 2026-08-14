# @deepseek-ai/dsh-file-review

[English](README.md) | 中文

这是一个可安装的 DeepSeek Harness Web 插件。Agent 完成一轮任务后，插件会把该轮产出的文件显示为审查按钮；选择文件后，页面内 Modal 会用单一内容流展示带行号的 unified diff，支持展开未修改区间、查看逐文件增删统计、复制 diff，以及按需执行**在编辑器中打开**。

本包独立拥有轮次聚合器、审查 Modal、diff 算法、CSS Modules 构建配置、浏览器 bundle 和 profile patch。它只通过 peer dependency 使用已发布的 Harness 插件 API，从不导入 deepseek-harness 仓库中的源码或共享构建预设。

## 功能特性

- **产物文件行** — 一轮结束后，收尾回复下方出现一排文件 chip，按首次出现顺序去重；溢出时折叠为本地化的 `+N 个文件` 余数，并在窗口尺寸变化时重新测量。
- **带行号的 unified diff** — 新旧行号双栏、增删标记、每个 hunk 保留 3 行上下文；当结果视图提供 `oldStart`/`newStart` 时，保留源码中的绝对行号。
- **可展开的未修改区间** — 折叠的上下文可在行内重新展开；多次编辑之间跳过未修改行时，文件头会显示省略行数。
- **逐文件增删统计** — 每个文件头部汇总其全部 hunk 的 `M` 状态及累计的 `+增加`、`-删除` 行数。
- **一键复制 diff** — 把记录的所有 hunk 复制为纯文本 unified diff。
- **正文提及可点击** — 收尾消息中的行内代码文件引用会变成指向同一批审查目标的链接。
- **在编辑器中打开** — 相对路径通过 chat 视图的 `openFile` 能力打开；浏览器经 loopback 连接且 Host 支持原生路径打开时，额外显示**在文件夹中显示**。
- **双语界面** — 简体中文与英文词典，跟随 Web UI 的语言设置。

## 环境要求

- DeepSeek Harness `0.1.x`，使用 **Web** profile。
- Harness 包与 React 是 peer dependency，由 profile 的共享运行时解析；本包只自行打包 `diff` 这一个依赖。

## 安装

将已发布的包安装进 Web profile：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-file-review
```

安装后重启 Web profile——启动器在启动时加载插件 bundle。卸载命令：

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-file-review
```

安装本地 checkout 时，先安装其依赖并运行 `npm run build`，再把 `add` 命令中的包名替换为 `./plugins/dsh-file-review`。打包后的 tarball 可以直接使用 `.tgz` 路径安装。

## 工作原理

本插件是一个包、两半实现，通过 `package.json` 的 `dsh.client` 声明被发现：

- **Node 入口**（`src/index.ts`）注册一段固定系统提示词，要求模型用 Markdown 行内代码提及变更文件——使用精确的文件工具路径，或在该轮变更文件中唯一时的 basename。这段提示词让正文中的审查目标可以点击。
- **浏览器入口**（`src/client/index.ts`）注册按轮次聚合的 `deliverables` 累加器、chat 视图轮次尾部链上的产物文件行、`file-review` 语言词典，以及把收尾正文中的行内代码引用变成链接的 `chatFileMentions` 服务。

文件是否算作"产出"只依据修改工具自身的 follow-along `locations`，从不依据收尾正文——即使模型忘记提及，产出的文件也会被列出。修改按渲染意图识别（diff 卡片，或通用 edit 卡片），而不是按工具名，因此读取、删除、失败调用，以及没有修改位置记录的终端间接产出都不会生成条目，嵌套的 Code Mode 分发也不会重复计数。

## 审查界面

点击 chip 会为对应文件打开审查 Modal：

- **行号** — 结果视图提供 `oldStart`/`newStart` 时保留源码中的绝对行号；否则每个已记录 hunk 从第 1 行开始编号，内容顺序与增删文本仍保持准确。
- **Hunk 渲染** — 每个 hunk 保留 3 行上下文，未修改连续段折叠为可展开间隔，文件头汇总显示 `M`、`+增加` 与 `-删除`。
- **不可用状态** — 某次修改只报告文件位置而没有可重建的 diff 文本时，Modal 显示明确的不可用提示；仍可从 Modal 中打开该文件。
- **操作** — **关闭**、**在编辑器中打开**（通过 chat 视图的 `openFile`）与**复制**。只有部分 chip 溢出、浏览器经 loopback 连接、且当前 Host 报告支持原生路径打开时，才显示**在文件夹中显示**。

## 包契约

Node 插件从 `@deepseek-ai/dsh-file-review` 导出，浏览器插件从 `@deepseek-ai/dsh-file-review/client` 导出；浏览器产物通过 Harness 模块加载器自行注册。manifest 的 `dsh.bundle` 指向 `cordis.patch.yml`；使用方应安装 bundle，而不是手写 Cordis 条目。Harness 包与 React 均为 peer dependency，Host 和浏览器因此继续使用同一份运行时实例；`diff` 是唯一打进 bundle 的运行时依赖。CSS Modules 在运行时编译为自注入的 `<style>` 元素，因此 tarball 不需要单独的样式表。

## 开发与发布

开发环境需要 pnpm，以及落在 tsdown engine 范围内的 Node.js 版本（`^22.18.0 || >=24.11.0`）。在本目录安装 manifest 中的依赖，然后运行：

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm pack --dry-run
```

`pnpm test` 会先构建包，再运行 Vitest 测试套件（Node 半的提示词注册、浏览器半的推导与渲染、以及已发布 bundle 的交接），最后校验 npm tarball 内容。`prepack` 会再次执行类型检查、测试和构建。npm tarball 包含预构建的 `lib/index.js`、`lib/client.js`、类型声明、source map、profile patch 与双语 README；安装时不需要 deepseek-harness 源码树。

## 常见问题

| 现象 | 说明 |
| --- | --- |
| 一轮结束后没有产物文件行 | 该轮成功的修改工具结果没有报告 `locations`，或文件由终端命令写入而没有修改位置记录。 |
| Modal 提示没有可重建的差异 | 结果视图只带位置、没有可重建的 hunk 文本——大型覆盖结果常见。可以直接从 Modal 打开文件。 |
| 正文中的文件引用不可点击 | 该 token 既不是精确的产物路径，也不是唯一 basename——存在歧义的 basename 按设计保持不可点击。 |
| 没有**在文件夹中显示**按钮 | 需要 chip 溢出，加上 loopback 连接和报告支持原生路径打开的 Host。 |
| 安装后插件未生效 | 重启 Web profile；插件 bundle 在启动时加载。 |

## 限制

- 审查展示已记录的修改序列，不是工作区从初始状态到最终状态的比较，也不包含用户之后的编辑。
- 精确路径和唯一 basename 会变成链接；存在歧义的 basename 保持不可点击。
- 大型覆盖结果可能省略修改前文本，因此部分成功修改无法展示完整的双侧 diff。
- 本包面向 DeepSeek Harness `0.1.x` 客户端插件协议；peer dependency 范围会拒绝不兼容的未来协议版本。

## 许可证

以 MIT 许可证发布。
