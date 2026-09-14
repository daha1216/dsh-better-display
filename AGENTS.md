# dsh-better-display（daha1216 fork）agent 工作手册

本仓库是 hand-bundle 仓库：**实际被 dsh web 加载运行的是 `lib/client.js`，不是 src 的编译产物**。
改任何东西都必须「src + lib/client.js 双改」，只改 src 等于没改。

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
  `UserMessageActions`、`MainNode`、`RetraceUserActions`、`cleanErrorMessage`、`Reader()`。
- **CSS Module 的编译形态**：`src/client/Reader.module.css` 编译成两处，改样式两边都要动：
  1. `const css$4 = "...";`（搜 `g2GnNq_root`）——压缩后的 CSS 全文；新规则追加到字符串末尾即可（同名后置规则会覆盖前者）。
  2. `Reader_module_css_default = { "类名": "g2GnNq_类名", ... }`——class map；新类名必须在这里注册，组件里用 `Reader_module_css_default.类名` 引用，否则 undefined。
- **jsx 陷阱**：bundle 里 `(0, react_jsx_runtime.jsx)(type, props, third)` 的第三个参数是 **key 不是 children**。按钮文字等必须写 `props.children`，放第三参会静默丢失（历史上踩过：按钮空白）。
- **memo 陷阱**：`useMemo(fn, [store])` 里 ChatNodeStore 引用恒定不变，会冻结早挂载时的空结果；依赖数组必须带会变化的值（如 `order.length`）。
- dsh-retrace 注入的全局类（`.dsh-rt-editor` / `.dsh-rt-textarea` / `.dsh-rt-editor-buttons` / `.dsh-rt-error` / `.dsh-rt-chip`）属于对方插件，**不要改语义**，reader 里可以搭配本仓库自己的 module 类组合使用。

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

用户消息操作行（`Reader.tsx` MainNode user 分支）：`.userActions`（flex/wrap、min-height 28px、gap 8px）一行内依次是 messageClock · 复制 iconButton · retrace chips（`.retraceChip` ghost 文字钮；`.retraceChipDanger` hover 变红；`.retraceChipArmed` 待确认常红）· 复制回执 meta。编辑器/报错用 `.retraceRowBreak{flex-basis:100%}` 换到独立行。触屏规范：`@media (pointer:coarse)` 下交互钮最小 44px；已有容器查询 `@container (width<=420px / 480px)`。

## 4. 部署与验证闭环

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
