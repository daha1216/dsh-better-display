import { useState } from 'react';
import { callRetraceOp, readRetraceConfig } from './retrace.js';

/**
 * Reading-view port of dsh-retrace's per-message action row (编辑 / 撤回).
 * Reuses retrace's own global `.dsh-rt-*` stylesheet and host RPCs, so the
 * chips look and behave exactly like the ones in the chat view.
 */
export function RetraceUserActions({ sessionId, messageId, text, fillComposer }: {
  sessionId: string;
  messageId: string | undefined;
  text: string;
  fillComposer?: (text: string) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!messageId) return null;

  const openEditor = () => {
    setDraft(text);
    setFailure(null);
    setEditing(true);
  };

  const run = async (op: 'recall' | 'editAndResend', extra: Record<string, unknown> = {}): Promise<void> => {
    setBusy(true);
    setFailure(null);
    const result = await callRetraceOp(op, { sessionId, messageId, ...extra });
    setBusy(false);
    if (!result.ok) {
      const code = result.error?.code;
      setFailure(code === 'agent-busy' ? '智能体正在运行，等这一轮结束后再试。' : (result.error?.message ?? '操作未成功，请稍后重试。'));
      return;
    }
    if ((result.value as { markerT1Broken?: boolean } | undefined)?.markerT1Broken === true) {
      setFailure('编辑已生效；此处标记会让 /compact 失效，建议稍后离线清理。');
    }
    if (op === 'recall') {
      const echoed = typeof result.value?.text === 'string' && result.value.text.length > 0 ? result.value.text : text;
      if (echoed) fillComposer?.(echoed);
      return;
    }
    setEditing(false);
  };

  return <div className="dsh-rt-user-row">
    {editing
      ? <div className="dsh-rt-editor">
        <textarea
          className="dsh-rt-textarea"
          aria-label="编辑这条消息"
          value={draft}
          rows={3}
          onChange={event => setDraft(event.target.value)}
        />
        <div className="dsh-rt-editor-buttons">
          <button
            type="button"
            className="dsh-rt-editor-send"
            disabled={busy || draft.trim().length === 0}
            onClick={() => { void run('editAndResend', { text: draft.trim(), fromScratch: readRetraceConfig().editFromScratch }); }}
          >发送</button>
          <button
            type="button"
            className="dsh-rt-editor-cancel"
            disabled={busy}
            onClick={() => { setEditing(false); setFailure(null); }}
          >取消</button>
        </div>
      </div>
      : <span className="dsh-rt-user-actions">
        <button type="button" className="dsh-rt-chip" title="编辑" disabled={busy} onClick={openEditor}>编辑</button>
        <button type="button" className="dsh-rt-chip" title="撤回这条消息" disabled={busy} onClick={() => { void run('recall'); }}>撤回</button>
      </span>}
    {failure !== null && <div className="dsh-rt-error" role="status">{failure}</div>}
  </div>;
}
