## 0.1.1 — daha1216 fork（2026-09-14）

- 阅读页接入 dsh-retrace 的自定义会话节点：
  - `recall-marker`：按操作渲染轻量提示行（此前的消息已撤回 / 此处编辑重发 / 此处重新生成，附撤出上下文的记录数）；压缩检查点静默跳过。
  - `user-actions` / `retrace-reference`：交互控件与原提问参照块在阅读页跳过（阅读页为被动展示，撤回分界已由提示行表达）。
- 上游：aa2246740/dsh-better-display@0.1.0。
# Changelog

## Unreleased

Stock DeepSeek Harness install: `dsh plugin --profile web add github:aa2246740/dsh-better-display`, then restart that Host and reload. Ships `dsh.bundle.patch` → `cordis.patch.yml` and committed `lib/`. No `prepare`.

## 0.2.1

- **Rail jump no longer lifts the composer**: the right-hand turn rail lands on `[data-conversation-scroll]` the same way official ChatView does. `scrollIntoView` was also scrolling ancestor boxes, so jumping to the top of history and then back to the latest turn left the sticky input card stranded up the column.

## 0.2.0

Adds native generative MCP Apps (SEP-1865) support and rich interactive rendering.

- **Generative MCP Apps**: auto-detect ````mcp-app` code blocks (or `mcp-app` custom blocks / `render_ui`/`show_widget` tool results) and mount them as live, interactive cards.
- **Sandboxed iframe**: `sandbox="allow-scripts allow-forms"` without `allow-same-origin`, `referrerPolicy="no-referrer"` — full isolation from host cookies/tokens/DOM.
- **SEP-1865 JSON-RPC bridge**: `ui/initialize`, `ui/resize`, `ui/submit` / `ui/update-model-context`, plus live `host-context-changed` theme broadcasts.
- **Bidirectional feedback**: user interactions produce a natural-language prompt written straight into the composer via React 18 native setter (instant, no stale-DOM whitespace).
- **Live dark/light sync**: MutationObserver + matchMedia drive instant re-theming with zero first-frame flash.
- **Pixel-perfect auto height**: content-bottom bounding-box measurement + ResizeObserver; 60px–2400px smooth grow/shrink, no double scrollbars or wasted whitespace.
- **Redesigned minimal container**: removed protocol/status chrome, 14px-radius subtle card, icon-only reset.
- **Skill pack**: `skills/generative-mcpapps/` with SKILL.md, protocol reference, HTML boilerplate template, and interactive quiz example.
- **Docs**: bilingual `README.md` / `README.en.md`; DESIGN.md contract updated.
- 49 regression tests.

## 0.1.0

First public release of the accepted reading-view plugin, published as `dsh-better-display`.

- Native context and tool details with source-ordered, unmodified reasoning.
- Bounded long-reasoning cards with two-line following, expanded follow and manual pause/resume.
- Successful-turn process folding with a separate final answer.
- Source-ordered text reveal and quiet busy-state shimmer.
- Stable status typography and compact disclosure spacing.
- Native content fallbacks and a trusted-plugin block extension slot.
- 42 regression tests; no changes to DSH Agent, SDK, providers or core.
