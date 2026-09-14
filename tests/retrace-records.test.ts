import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client';
import { originalInputPreview, shadowedRecordSummaries } from '../src/client/retrace.ts';

/** Minimal node factory: only the fields the resolver reads. */
function node(kind: string, key: string, anchorSeq: number, data: unknown): ChatConversationViewNode {
  return { key, kind, anchorSeq, visibility: 'visible', data } as unknown as ChatConversationViewNode;
}

function store(nodes: ChatConversationViewNode[]): { values(): readonly ChatConversationViewNode[] } {
  return { values: () => nodes };
}

const user = (seq: number, text: string, time = 1_700_000_000_000) => node('user', `u${seq}`, seq, {
  seq, time, content: [{ type: 'text', text }],
});

test('recalled record summaries resolve user content, time and order from live nodes', () => {
  const nodes = store([user(12, '第一条\n第二条'), user(13, '后续消息', 1_700_000_060_000)]);
  const records = shadowedRecordSummaries(nodes, [13, 12]);
  assert.deepEqual(records, [
    { seq: 13, time: 1_700_000_060_000, text: '后续消息', resolved: true },
    { seq: 12, time: 1_700_000_000_000, text: '第一条\n第二条', resolved: true },
  ]);
});

test('a shadowed seq missing from the loaded window stays listed as unresolved', () => {
  const records = shadowedRecordSummaries(store([user(12, '在窗口内')]), [99, 12]);
  assert.deepEqual(records, [
    { seq: 99, time: null, text: '', resolved: false },
    { seq: 12, time: 1_700_000_000_000, text: '在窗口内', resolved: true },
  ]);
});

test('duplicate and non-numeric shadowed seqs collapse without reordering', () => {
  const nodes = store([user(12, 'a'), user(14, 'b')]);
  const records = shadowedRecordSummaries(nodes, [14, 14, 'x', null, 12, 14]);
  assert.deepEqual(records.map(record => record.seq), [14, 12]);
  assert.equal(shadowedRecordSummaries(nodes, []).length, 0);
});

test('assistant, tool and turn-tail rows resolve through their own durable seq', () => {
  const nodes = store([
    node('assistant-step', 'a1', 14, {
      time: 5,
      blocks: [{ kind: 'reasoning', text: '思考' }, { kind: 'text', text: '回答' }, { kind: 'reasoning', text: '再想' }],
    }),
    node('tool-call', 't1', 15, { root: { seq: 16 } }),
    node('turn-tail', 'tt1', 17, { closing: { finalNode: { seq: 18 }, blocks: [{ kind: 'text', text: '收尾' }] } }),
  ]);
  const records = shadowedRecordSummaries(nodes, [14, 16, 18]);
  assert.deepEqual(records, [
    { seq: 14, time: 5, text: '回答', resolved: true },
    { seq: 16, time: null, text: '', resolved: true },
    { seq: 18, time: null, text: '收尾', resolved: true },
  ]);
});

test('pseudo rows never shadow their own target message', () => {
  // `retrace-reference` anchors at `seq - 0.5`; its ceil would collide with the
  // user message seq, but only the real message row may supply the summary.
  const nodes = store([
    node('retrace-reference', 'r1', 12.5, { seq: 12, content: [{ type: 'text', text: '引用块正文' }] }),
    user(12, '真正的用户消息'),
    node('user-actions', 'ua1', 12, { seq: 12 }),
  ]);
  const records = shadowedRecordSummaries(nodes, [12]);
  assert.deepEqual(records, [{ seq: 12, time: 1_700_000_000_000, text: '真正的用户消息', resolved: true }]);
});

test('a bare user node without time still resolves its text', () => {
  const bare = node('user', 'u7', 7, { seq: 7, content: [{ type: 'text', text: '无时间' }] });
  assert.deepEqual(shadowedRecordSummaries(store([bare]), [7]), [
    { seq: 7, time: null, text: '无时间', resolved: true },
  ]);
});

test('original input preview folds to the first non-empty line with collapsed whitespace', () => {
  assert.equal(originalInputPreview('\n\n  第一行   有   空格  \n第二行'), '第一行 有 空格');
  assert.equal(originalInputPreview('   '), '');
  assert.equal(originalInputPreview('单行短文本'), '单行短文本');
});

test('original input preview clamps long lines at the limit with an ellipsis', () => {
  const long = 'a'.repeat(120);
  const preview = originalInputPreview(long);
  assert.equal(preview.length, 81);
  assert.equal(preview, `${'a'.repeat(80)}…`);
  // A space at the cut is trimmed before the ellipsis.
  assert.equal(originalInputPreview('12345 67890', 5), '12345…');
  assert.equal(originalInputPreview('abcd efgh', 5), 'abcd…');
});
