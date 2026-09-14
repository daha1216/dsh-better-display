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

- 文件是各模块按 `//#region src/client/...` 拼接的产物。常用锚点（用函数名搜索，行号会漂移）：
  `UserMessageActions`、`MainNode`、`cleanErrorMessage`、`Reader()`、`computeShadowPlan` / `retraceHiddenKeysFor`（`src/client/retrace.ts`）。
- **CSS Module 的编译形态**：`src/client/Reader.module.css` 编译成两处，改样式两边都要动：
  1. `const css$4 = "...";`（搜 `g2GnNq_root`）——压缩后的 CSS 全文；新规则追加到字符串末尾即可（同名后置规则会覆盖前者）。
  2. `Reader_module_css_default = { "类名": "g2GnNq_类名", ... }`——class map；新类名必须在这里注册，组件里用 `Reader_module_css_default.类名` 引用，否则 undefined。
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

用户消息操作行（`Reader.tsx` 的 `MainNode` user 分支 → `Blocks.tsx` 的 `UserMessageActions`）：`.userActions`（flex、min-height 28px、gap 8px）一行内只有 messageClock · 复制 iconButton（`aria-label="复制消息"`）· 复制回执 meta。**编辑/撤回 chips、内联编辑器、报错不在这里**——它们由 dsh-retrace 的阅读页注入器挂到复制按钮所在行和消息簇末尾（详见其 AGENTS.md 第 3 节）。触屏规范：`@media (pointer:coarse)` 下交互钮最小 44px；已有容器查询 `@container (width<=420px / 480px)`。

## 4. 展示职责与锚点契约（与 dsh-retrace 的分工）

本仓库只做纯展示；撤回操作 UI（编辑/撤回 chips、两步确认、内联编辑器、报错行）全部由 **dsh-retrace** 负责，并在阅读页通过 DOM 注入自行挂载。本仓库保留的展示能力：

- **shadow 行隐藏**：`computeShadowPlan` / `retraceHiddenKeysFor`（`src/client/retrace.ts`），按 recall-marker 的 `shadowedSeqs` 算出要隐藏的 node key；`RETRACE_PSEUDO_KINDS` 覆盖 `user-actions` / `retrace-reference` / `recall-marker` 等伪节点。
- **撤回标记**：recall-marker 节点的展示。
- **原文引用块**：`retrace-reference` 节点 → `.originalInput*`（`g2GnNq_originalInput` 等），标题「编辑前的原文」。

**锚点契约（不可移除）**：`Reader.tsx` 的 `MainNode` user 分支在用户消息簇上输出 `data-reader-anchor data-reader-key={nodeKey}`；dsh-retrace 的阅读页注入器**只靠这两个属性**定位消息簇（再找 `button[aria-label="复制消息"]` 所在行插 chips）。本仓库自己的 motion/滚动定位也依赖 `data-reader-anchor`。**移除或改名这两个属性会同时打断两边的功能**，改之前先与 retrace 侧对齐。

## 5. 部署与验证闭环

```sh
# 1) bump package.json version，三关检查：
node --check lib/client.js
node --import tsx/esm --test tests/*.test.ts
./node_modules/.bin/tsc -p tsconfig.json --noEmit   # link 脚本见第 1 节
# 2) commit + push origin main
# 3) 停服务 → 更新插件 → 重启：
powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/daha/.dsh/stop-dsh-web.ps1
cd C:/Users/daha/.dsh && HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 dsh plugin --profile web update dsh-better-display
powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/daha/.dsh/launch-deepseek-harness.ps1 -NoOpen
```

- profile 依赖是 `github:daha1216/dsh-better-display`（未钉 commit，解析 main HEAD），所以**必须先 push 再 update**。
- 插件 bundle 走 `rev` 缓存：更新后浏览器旧标签要刷新一次才是新代码。
- E2E 习惯：role 定位器在本应用常超时，用 `tab.playwright.evaluate()` + `dispatchEvent(new MouseEvent("click",{bubbles:true}))`；输入框用 React 原生 value setter + `input` 事件（execCommand 对 textarea 不可靠）。
