import { memo, useEffect, useRef, useState } from 'react';
import { callRetraceOp, readRetraceConfig } from './retrace.js';
import css from './Reader.module.css';

/** Auto-revert window for the armed 撤回 chip before a second click executes. */
const RECALL_CONFIRM_MS = 3000;

/**
 * Reading-view port of dsh-retrace's per-message action row (编辑 / 撤回).
 * Renders ghost text buttons that merge into the reader's own userActions row
 * (clock · copy · 编辑 · 撤回); the editor and failure notices break onto
 * their own line. 撤回 is armed on first click and executes only on a second
 * click within {@link RECALL_CONFIRM_MS}.
 */
export const RetraceUserActions = memo(function RetraceUserActions({ sessionId, messageId, text, fillComposer }: {
  sessionId: string;
  messageId: string | undefined;
  text: string;
  fillComposer?: (text: string) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);
  if (!messageId) return null;

  const disarm = () => {
    window.clearTimeout(confirmTimer.current);
    setConfirming(false);
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

  const openEditor = () => {
    disarm();
    setDraft(text);
    setFailure(null);
    setEditing(true);
  };

  const armRecall = () => {
    if (confirming) {
      disarm();
      void run('recall');
      return;
    }
    setConfirming(true);
    confirmTimer.current = window.setTimeout(() => setConfirming(false), RECALL_CONFIRM_MS);
  };

  return <>
    {editing
      ? <div className={`dsh-rt-editor ${css.retraceRowBreak}`}>
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
      : <span className={css.retraceChips}>
        <button type="button" className={css.retraceChip} title="编辑" disabled={busy} onClick={openEditor}>编辑</button>
        <button
          type="button"
          className={confirming ? `${css.retraceChip} ${css.retraceChipArmed}` : `${css.retraceChip} ${css.retraceChipDanger}`}
          title={confirming ? '再点一次执行撤回' : '撤回这条消息'}
          disabled={busy}
          onClick={armRecall}
        >{confirming ? '确认撤回？' : '撤回'}</button>
      </span>}
    {failure !== null && <div className={`dsh-rt-error ${css.retraceRowBreak}`} role="status">{failure}</div>}
  </>;
});
