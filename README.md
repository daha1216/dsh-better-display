# dsh-better-display

[English](./README.en.md) · [简体中文](./README.md)

> **本仓库是 [aa2246740/dsh-better-display](https://github.com/aa2246740/dsh-better-display) 的增强 Fork**（v0.1.1）：
> 在上游沉浸式阅读页与 MCP-App 交互沙箱基础上，**深度适配 [dsh-retrace](https://github.com/daha1216/dsh-retrace) 会话回溯节点**（撤回、编辑重发、重新生成提示行原生渲染，跳过非阅读态控件）。

```sh
dsh plugin --profile web add github:daha1216/dsh-better-display
```

---

## 💡 这是什么

给 DeepSeek Harness 增加一个专为阅读体验设计的 **「阅读」** 页签：
- **执行过程实时可见**：Agent 执行时正常展示思考链路、步骤与实时进度。
- **完成后自动收起**：整轮执行成功结束后，自动收起繁杂的工具调用与中间日志，仅保留最纯净的最终回答。
- **保留所有原生能力**：原版「对话 / 轨迹」、输入框、模型切换、工具调用及沙箱审批全部无损保留，随时一键切换。
- **新会话默认进阅读**：开箱即用，降低长会话与大量工具调用的视觉噪音。

---

## ✨ 核心特性

### 1. 🧭 深度联动 dsh-retrace（本 Fork 特性）
当您搭配安装了 `dsh-retrace` 会话时光机插件时，阅读页提供专属适配：
- **智能提示行渲染**：识别 `recall-marker`，在阅读流中轻量提示「此前的消息已撤回 / 此处编辑重发 / 重新生成（撤出 X 条记录）」。
- **界面整洁无干扰**：自动跳过回溯内部的压缩检查点与非阅读态交互控件（`user-actions` / `retrace-reference`），使阅读页面的上下文保持平滑连贯。

### 2. 🧩 Generative MCP Apps 交互卡片
- 最终回答中若包含 ````mcp-app` 代码块、自定义 block 或 `render_ui` / `show_widget` 工具输出，会自动挂载为交互式微应用卡片。
- **隔离沙箱运行**：运行于独立的 `<iframe sandbox="allow-scripts allow-forms">`（无 `allow-same-origin`，零权限逃逸）。
- **双向 Prompt 回填**：卡片可通过 JSON-RPC 协议将用户在卡片内的操作（如表单、选项、测试题）直接回填到底部输入框开启下一轮会话。

### 3. 🎯 渐进式推理体验与自动高度
- 深度优化的思考流展示，支持双行跟随、手动暂停/恢复滚屏。
- 基于 `ResizeObserver` 的像素级自适应高度卡片，杜绝双滚动条与空白留白。
- 零延迟的深浅色主题同步广播。

---

## 📦 安装与更新

### 环境要求
- 带 `dsh` CLI 的 DeepSeek Harness（面向 **0.1.5-rc.2 及以上**）。若未配置全局命令可用 `npx @deepseek-ai/dsh`。
- Node.js `^22.19.0 || >=24`，系统已安装 `pnpm`。

### 安装命令
仓库已预编译提交产物 `lib/`，无需 `prepare`，直接拉取即可：

```sh
dsh plugin --profile web add github:daha1216/dsh-better-display
```

> **注意**：安装完成后请**重启 DSH Web Host 并刷新网页**（插件需在启动时加载，不支持动态热挂载）。

### 更新命令

```sh
dsh plugin --profile web add github:daha1216/dsh-better-display
```

### 卸载

```sh
dsh plugin --profile web remove dsh-better-display
```

---

## 🛠️ 本地开发

```sh
# 类型检查
npm run typecheck

# 运行测试
npm test
```

---

## 📄 许可证

- 展示组件与 Markdown 基础部分来自 DeepSeek Harness（MIT）。
- 动效设计参考 [Transitions.dev](https://transitions.dev/)。
- 本仓库代码遵循 [MIT](LICENSE) 许可。
