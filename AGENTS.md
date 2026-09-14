# dsh-better-display（daha1216 fork）agent 工作手册

本仓库是 hand-bundle 仓库：**实际被 dsh web 加载运行的是 `lib/client.js`，不是 src 的编译产物**。
改任何东西都必须「src + lib/client.js 双改」，只改 src 等于没改。

本仓库是**纯展示**插件（v0.1.4+）：只负责 shadow 行隐藏、撤回标记、原文引用块等阅读页展示，**不含任何编辑/撤回操作 UI**——操作 UI 全部归 dsh-retrace（它在阅读页用 DOM 注入自行挂载 chips）。

## 1. 构建链约束（先读，别踩）

- `tsdown` / `npm run build` **不可用**：依赖私有 `tools/dshx/src/client-build.js`（上游作者内部工具，本仓库没有）。不要尝试修复它。
- 类型检查（唯一可用的构建步骤）：
  ```sh
  node scripts/link-harness-dependencies.mjs C:/dsh/deepseek-harness
  ./node_modules/.bin/tsc -p tsconfig.json --noEmit
  ```
- **不要在仓库里跑 `pnpm install` / `pnpm test`**：会隐式生成 `pnpm-lock.yaml`、`pnpm-workspace.yaml`（已 gitignore，勿提交）。测试直接跑：
  ```sh
  node --import tsx/esm --test tests/*.test.ts
  ```
- bundle 改完后必查语法：`node --check lib/client.js`。

## 2. lib/client.js 手改规则

- 文件是各模块按 `//#region src/client/...` 拼接的产物（bundle 内共 126 处 `//#region`，其中 35 处是 `src/client/`；`retrace.ts` 段约 47434 行起）。常用锚点（用函数名搜索，行号会漂移）：
  `UserMessageActions`（`Blocks.tsx`）、`MainNode` / `cleanErrorMessage` / `Reader()`（`Reader.tsx`）、`computeShadowPlan` / `readRetraceConfig` / `RETRACE_PSEUDO_KINDS`（`src/client/retrace.ts`）。
  **注意 src 名与 bundle 名可能不同**：shadow 相关的 bundle 名是 `retraceHiddenKeysFor` / `retraceEditOriginalTextsFor`（后者 v0.1.5 新增，把 `edit` marker 映射到其后第一条用户消息的原文），src 侧对等私有名是 `hiddenKeysFor` / `editOriginalTextsFor`；src 的 `PSEUDO_KINDS` 在 bundle 里叫 `RETRACE_PSEUDO_KINDS`。在 src 里搜不到 `retrace*` 前缀是正常的，别以为丢了。
- **CSS Module 的编译形态**：`src/client/Reader.module.css` 编译成两处，改样式两边都要动：
  1. `const css$4 = "...";`（搜 `g2GnNq_root`）——压缩后的 CSS 全文；新规则追加到字符串末尾即可（同名后置规则会覆盖前者）。
  2. `Reader_module_css_default = { "类名": "g2GnNq_类名", ... }`——class map；新类名必须在这里注册，组件里用 `Reader_module_css_default.类名` 引用，否则 undefined。
  `TimelineRail.module.css` 同形：搜索 `--turn-rail-band` 找到 `const css = "..."`（前缀 `q_MLFG_`），class map 是 `TimelineRail_module_css_default`。
- **纯函数模块**：`src/client/reader-settings.ts`（v0.2.0 新增，settings 档位表 + `readerSettingVars`）在 bundle 里是独立 `//#region src/client/reader-settings.ts`（位于 store 段之前），函数名同 src（`readerSettingVars` / `normalizeFontSize` / `readerFontMode`）；`reader-settings.ts` 不 import retrace，store.ts 只 import 它。
- **jsx 陷阱**：bundle 里 `(0, react_jsx_runtime.jsx)(type, props, third)` 的第三个参数是 **key 不是 children**。按钮文字等必须写 `props.children`，放第三参会静默丢失（历史上踩过：按钮空白）。
- **memo 陷阱**：`useMemo(fn, [store])` 里 ChatNodeStore 引用恒定不变，会冻结早挂载时的空结果；依赖数组必须带会变化的值（如 `order.length`）。
- `.dsh-rt-*` 全局类（`.dsh-rt-ghost*` chips、`.dsh-rt-editor*`、`.dsh-rt-error` 等）全部属于 dsh-retrace。本仓库自 v0.1.4 起已不再引用任何 `.dsh-rt-*`（`grep -c dsh-rt lib/client.js` 应为 0），**也不要再新增**；撤回操作 UI 由 retrace 通过 DOM 注入自行挂载。

## 3. 视觉样式速查（reader 阅读页）

设计 token（跟 dsh web 主题走，勿写死色值）：

| 用途 | token |
| --- | --- |
| 文字层级 | `--dsw-alias-label-primary / -secondary / -tertiary` |
| hover 底色 | `--dsw-alias-interactive-bg-hover`（solid 变体加 `-solid`） |
| 危险红 | `--dsw-alias-state-error-primary` |
| 边框 | `--dsw-alias-border-l1 / -l2 / -l3` |
| 底色 | `--dsw-alias-bg-base / -elevated / -module-platform` |
| 用户气泡 | `--dsw-specific-bubble` |

用户消息操作行（`Reader.tsx` 的 `MainNode` user 分支 → `Blocks.tsx` 的 `UserMessageActions`）：`.userActions`（flex、min-height 28px、gap 8px；`Reader.module.css` 约 229 行）一行内只有 messageClock · 复制 iconButton（`aria-label="复制消息"`）· 复制回执 meta。**编辑/撤回 chips、内联编辑器、报错不在这里**——它们由 dsh-retrace 的阅读页注入器挂到复制按钮所在行和消息簇末尾（详见其 AGENTS.md 第 3 节）。触屏规范：`@media (pointer:coarse)` 下交互钮最小 44px（如 `.disclosureButton`/`.reasonAction`）；已有容器查询 `@container (width<=420px / 480px)`（bundle 压缩写法，src 写作 `@container (max-width: 420px / 480px)`）。

## 4. 展示职责与锚点契约（与 dsh-retrace 的分工）

本仓库只做纯展示；撤回操作 UI（编辑/撤回 chips、两步确认、内联编辑器、报错行）全部由 **dsh-retrace** 负责，并在阅读页通过 DOM 注入自行挂载。本仓库保留的展示与阅读偏好能力：

- **shadow 行隐藏**：`computeShadowPlan` / `retraceHiddenKeysFor`（bundle 名；`src/client/retrace.ts`，src 侧对等私有名 `hiddenKeysFor`），按 recall-marker 的 `shadowedSeqs` 算出要隐藏的 node key；`RETRACE_PSEUDO_KINDS`（src 名 `PSEUDO_KINDS`）覆盖 `user-actions` / `retrace-reference` / `recall-marker` 等伪节点。
- **撤回标记**：recall-marker 节点的展示。
- **原文引用块**：`retrace-reference` 节点 → `.originalInput*`（`g2GnNq_originalInput`，来源 `src/client/Reader.module.css` 约 275 行的 `.originalInput`/`.originalInputLabel`/`.originalInputBody`；bundle 里同样两处：压缩 CSS 串 `css$4` 末尾 + `Reader_module_css_default` class map 注册），标题「编辑前的原文」，受 `readRetraceConfig().showOriginalInput` 开关控制。原文文本取自 `op === 'edit'` 的 recall-marker 的 `data.text`（经 `retraceEditOriginalTextsFor` 映射到 marker 之后的第一条用户消息，与 retrace 对话页 `useEditReference` 语义一致）；显式 `data.text` 优先（旧/他方契约），**不读** `data.content`（那是消息自身当前正文，读了会让每条消息都长出原文块）。
- **可展开撤回标记**（批B）：recall-marker 折叠态仍是单行提示；当 `shadowedSeqs` 还能在 node store 里寻址时整行变成 disclosure，展开列出每条被撤出记录（seq + 时间 + 两行摘要，`shadowedRecordSummaries` 从 live nodes 解析；越界 seq 显示「已不可寻址」）。
- **可折叠原文块**（批B）：`retrace-reference` 的「编辑前的原文」默认只显示标题 + 单行摘要（`originalInputPreview`），点标题行用 `grid-template-rows` 高度过渡展开全文。
- **阅读设置 popover**（v0.2.0）：工具栏「阅读设置」按钮（原独立「动效」按钮已收进 popover）打开弹层，分三组——阅读本体 / 撤回展示 / 动效。存储分工是刻意的：
  - 阅读本体（字号 `fontSize`、行宽 `lineWidth`、密度 `density`）与动效 `motion` 存 store `dsh.reader.v1`（`src/client/store.ts`）。默认 `fontSize:'auto'`（跟随宿主 `--dsh-content-font-size`）、`lineWidth:'standard'`、`density:'standard'`，**默认档解析为零覆盖**（不产出 `--bd-reading-width` / `--bd-reading-font-size`，密度 var 就等于样式回退值 22px/12px），所以零配置视觉与旧版完全一致。显式字号档（13/14/15/16/17）按宿主公式（line-height `size+10`、标题 delta `size-14`、次级 `min(size-1,max(13,size-2))`）改写 `.answer`/`.user` 作用域内的宿主 markdown 字体 token，工具与过程 chrome 不在此选择器内。
  - 撤回展示 `showOriginalInput` / `hideShadowed` **不在 store 里**，由 `writeRetraceConfig`（`src/client/retrace.ts`）写回 localStorage 同键 `dsh-retrace:config`，与 retrace 插件共用同一 block（不迁移存储、不新增键；未知字段保留）。bd 的读取路径不变：`readRetraceConfig()` → `computeShadowPlan`，MainNode 改读从 Reader 传下来的配置对象以便即时重渲染。
  - 纯逻辑（档位表、归一化、CSS var 解析）在 `src/client/reader-settings.ts`，有单测覆盖。
- **移动端时间轴精简模式**（v0.2.0）：`TimelineRail.module.css` 的 `@media (max-width: 960px)` 不再 `display:none`，改为贴边细条——`.frame` 收到 14px 命中带 + 4px 视觉宽，刻度压成 3px 小点，当前轮 `[aria-current=true]` 的刻度加高至 12px 并强制 primary 色作为进度指示；预览气泡在窄屏关闭。**桌面 ≥960px 的规则与行为完全不变**（档位只写在媒体查询内，无桌面侧改动）。
- **长会话渲染性能**：`.turn { content-visibility: auto; contain-intrinsic-size: auto 520px }`（窄屏 760px）。容器刻意放在 `.turn` 而不是 `.root`/`.column`：放在 `.column` 会让它成为 containing block，破坏 TimelineRail 的滚动/定位数学。**与 retrace 注入器共存的结论**：`content-visibility` 只跳过屏外轮次的样式/布局/绘制，不改变 DOM 存在性，retrace 的 `[data-reader-anchor]` 查询与注入仍能命中从未渲染过的轮次；`auto <px>` 记住已渲染轮次的实测高度，未访问轮次用估值，避免滚动条与 `landTurn` 跳转在首次经过时跳变。

**锚点契约（不可移除）**：`Reader.tsx` 的 `MainNode` user 分支在用户消息簇上输出 `data-reader-anchor data-reader-key={nodeKey}`；dsh-retrace 的阅读页注入器**只靠这两个属性**定位消息簇（再找 `button[aria-label="复制消息"]` 所在行插 chips）。本仓库自己的 motion/滚动定位也依赖 `data-reader-anchor`。**移除或改名这两个属性会同时打断两边的功能**，改之前先与 retrace 侧对齐。

## 5. 部署与验证闭环

**当前版本**：v0.2.0（工作区；HEAD `b061214` + 未提交的批A/批B/本批改动）。版本号有三处必须同步：`package.json["version"]`、`src/client/Reader.tsx` 的 `READER_DISPLAY_VERSION`、bundle 内 `READER_DISPLAY_VERSION` 字面量（搜 `READER_DISPLAY_VERSION`）。

```sh
# 1) bump package.json version，三关检查：
node --check lib/client.js
node --import tsx/esm --test tests/*.test.ts   # 当前 92 个（v0.2.0 新增 reader-settings 9 个）
./node_modules/.bin/tsc -p tsconfig.json --noEmit   # link 脚本见第 1 节
# 2) commit + push origin main
# 3) 停服务
powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/daha/.dsh/stop-dsh-web.ps1
# 4) 更新插件（本仓 spec 未钉 commit，update 会重新解析 main HEAD）
cd C:/Users/daha/.dsh && HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 dsh plugin --profile web update dsh-better-display
# 5) 重启
powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/daha/.dsh/launch-deepseek-harness.ps1 -NoOpen
```

6. 浏览器**硬刷新**旧标签页（Ctrl+Shift+R）——插件 bundle 走 `rev` 缓存，普通刷新/F5 可能仍拿旧代码。
7. 在「阅读」tab 验证本次展示改动（shadow 隐藏 / 撤回标记 / 原文引用块）。**若异常出现在 chips、内联编辑器、报错行上，那不是本仓库的问题**——那些是 dsh-retrace 的 DOM 注入，去改它的 `.dsh-rt-*`（见其 AGENTS.md 第 3 节）；本仓库对它零引用。

- profile 依赖是 `github:daha1216/dsh-better-display`（未钉 commit，解析 main HEAD），所以**必须先 push 再 update**；dsh-retrace 则是钉死 commit、必须 `add` 重钉，别把两仓流程搞混。
- 拉 GitHub 必须带代理：`HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890`。
- 停服/重启脚本路径：`C:/Users/daha/.dsh/stop-dsh-web.ps1`、`C:/Users/daha/.dsh/launch-deepseek-harness.ps1 -NoOpen`。
- E2E 习惯：role 定位器在本应用常超时，用 `tab.playwright.evaluate()` + `dispatchEvent(new MouseEvent("click",{bubbles:true}))`；输入框用 React 原生 value setter + `input` 事件（execCommand 对 textarea 不可靠）。
