# 📖 dsh-better-display

> DeepSeek Harness 沉浸式阅读视图增强（基于 [aa2246740/dsh-better-display](https://github.com/aa2246740/dsh-better-display) 的增强 Fork）。

执行时展示过程，完成后自动收起繁杂步骤，仅保留清晰的最终回答；原生支持生成式 MCP-App 交互沙箱卡片，并深度适配 [dsh-retrace](https://github.com/daha1216/dsh-retrace) 会话回溯节点展示。

---

## 📦 安装与更新

```sh
# 安装 / 更新
dsh plugin --profile web add github:daha1216/dsh-better-display
```

> 安装或更新后请重启 DSH Web 并刷新页面。若环境变量中无全局 `dsh`，前面加上 `npx --yes -p @deepseek-ai/dsh`。

---

## ✨ 核心特性

- **执行过程自动折叠**：Agent 执行时正常展示思考与步骤，完成后自动收起中间日志，呈现纯净阅读视图。
- **深度适配 dsh-retrace**：智能渲染撤回、编辑重发与重新生成提示行，自动过滤中间干扰控件。
- **MCP-App 交互卡片**：在安全沙箱内渲染 ````mcp-app` 卡片，支持通过卡片交互双向回填 Prompt。
- **无损原生能力**：保留原版「对话 / 轨迹」视图、输入框及工具审批，支持随时切换。

---

## 📄 许可证

[MIT](LICENSE)
