import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client';

/**
 * Reading-view interop with the installed dsh-retrace plugin (0.4.x wire contract).
 *
 * The reader re-implements three small pieces of retrace's client instead of
 * importing its bundle: the localStorage preference block, the shadowed-row
 * hide plan, and the two host RPCs behind 编辑 / 撤回. Everything here is
 * defensive — when dsh-retrace is absent there are no `user-actions` nodes,
 * no markers, and the RPCs are simply never called.
 */

export interface RetraceConfig {
  showOriginalInput: boolean;
  editFromScratch: boolean;
  hideShadowed: boolean;
  versioning: boolean;
  git: boolean;
  retentionLimit: number;
}

const CONFIG_KEY = 'dsh-retrace:config';
const LEGACY_CONFIG_KEYS = ['dsh-message-editor:config'];
const CONFIG_DEFAULTS: RetraceConfig = {
  showOriginalInput: true,
  editFromScratch: false,
  hideShadowed: true,
  versioning: true,
  git: true,
  retentionLimit: 50,
};

export function readRetraceConfig(): RetraceConfig {
  try {
    let raw = localStorage.getItem(CONFIG_KEY);
    if (raw === null) for (const key of LEGACY_CONFIG_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy !== null) { raw = legacy; break; }
    }
    if (raw === null) return { ...CONFIG_DEFAULTS };
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    return { ...CONFIG_DEFAULTS, ...parsed };
  } catch {
    return { ...CONFIG_DEFAULTS };
  }
}

type ChatNodes = { values(): readonly ChatConversationViewNode[] };

const SHADOW_MIN_ROWS_FOR_RATIO = 20;
const SHADOW_SAFETY_RATIO = 0.4;
const PSEUDO_KINDS = new Set(['user-actions', 'retrace-reference', 'recall-marker']);

/**
 * Every chat-node key that disappears when `shadowedSeqs` are recalled.
 * Ported verbatim from retrace's client so both views hide identical rows.
 */
function hiddenKeysFor(shadowedSeqs: readonly unknown[] | null | undefined, nodes: ChatNodes): string[] | null {
  if (!Array.isArray(shadowedSeqs) || shadowedSeqs.length === 0) return null;
  const hidden = new Set(shadowedSeqs);
  const keys: string[] = [];
  for (const node of nodes.values()) {
    if (node.kind === 'recall-marker') continue;
    if (node.kind === 'turn-tail') {
      const closingSeq = (node.data as { closing?: { finalNode?: { seq?: unknown } } } | undefined)?.closing?.finalNode?.seq;
      if (typeof closingSeq === 'number' && hidden.has(closingSeq)) keys.push(node.key);
      continue;
    }
    if (node.kind === 'tool-call') {
      const resultSeq = (node.data as { root?: { seq?: unknown } } | undefined)?.root?.seq;
      if (typeof resultSeq === 'number' && hidden.has(resultSeq)) keys.push(node.key);
      continue;
    }
    if (typeof node.anchorSeq === 'number') {
      // Pseudo rows anchor at half seqs (retrace-reference uses `seq - 0.5`);
      // map the anchor back to its integer seq before matching.
      const anchored = node.anchorSeq % 1 === 0 ? node.anchorSeq : Math.ceil(node.anchorSeq);
      if (hidden.has(anchored)) keys.push(node.key);
    }
  }
  return keys.length === 0 ? null : keys;
}

function realRowCount(nodes: ChatNodes): number {
  let count = 0;
  for (const node of nodes.values()) {
    if (typeof node.anchorSeq === 'number' && !PSEUDO_KINDS.has(node.kind)) count += 1;
  }
  return count;
}

/** A marker that would hide most of the history degrades to notice-only. */
function shadowDegraded(keys: string[] | null, rowCount: number): boolean {
  if (keys === null || keys.length === 0) return false;
  if (rowCount < SHADOW_MIN_ROWS_FOR_RATIO) return false;
  return keys.length / rowCount > SHADOW_SAFETY_RATIO;
}

export interface RetraceShadowPlan {
  /** Node keys hidden because a non-degraded marker recalled them. */
  readonly hiddenKeys: ReadonlySet<string>;
  /** Message seqs inside any marker's shadowedSeqs, degraded or not. */
  readonly shadowedSeqs: ReadonlySet<number>;
  /** Markers whose hide set tripped the safety guard (rows stay visible). */
  readonly degradedMarkerKeys: ReadonlySet<string>;
}

const EMPTY_PLAN: RetraceShadowPlan = { hiddenKeys: new Set(), shadowedSeqs: new Set(), degradedMarkerKeys: new Set() };

export function computeShadowPlan(nodes: ChatNodes, config: RetraceConfig): RetraceShadowPlan {
  const markers: { key: string; seqs: readonly number[] }[] = [];
  for (const node of nodes.values()) {
    if (node.kind !== 'recall-marker') continue;
    const data = node.data as { compact?: boolean; shadowedSeqs?: unknown } | undefined;
    if (data?.compact) continue;
    const seqs = Array.isArray(data?.shadowedSeqs)
      ? data.shadowedSeqs.filter((value): value is number => typeof value === 'number')
      : [];
    markers.push({ key: node.key, seqs });
  }
  if (markers.length === 0) return EMPTY_PLAN;

  const shadowedSeqs = new Set<number>();
  for (const marker of markers) for (const seq of marker.seqs) shadowedSeqs.add(seq);
  if (!config.hideShadowed) return { hiddenKeys: new Set(), shadowedSeqs, degradedMarkerKeys: new Set() };

  const rowCount = realRowCount(nodes);
  const hiddenKeys = new Set<string>();
  const degradedMarkerKeys = new Set<string>();
  for (const marker of markers) {
    const keys = hiddenKeysFor(marker.seqs, nodes);
    if (shadowDegraded(keys, rowCount)) {
      degradedMarkerKeys.add(marker.key);
    } else if (keys !== null) {
      for (const key of keys) hiddenKeys.add(key);
    }
  }
  return { hiddenKeys, shadowedSeqs, degradedMarkerKeys };
}

/** seq → `user-actions` node payload, for pairing reader rows with retrace ops. */
export function collectUserActionsIndex(nodes: ChatNodes): Map<number, { messageId?: string }> {
  const index = new Map<number, { messageId?: string }>();
  for (const node of nodes.values()) {
    if (node.kind !== 'user-actions') continue;
    const data = node.data as { seq?: unknown; messageId?: unknown } | undefined;
    if (typeof data?.seq === 'number') index.set(data.seq, { messageId: typeof data.messageId === 'string' ? data.messageId : undefined });
  }
  return index;
}

export type RetraceOpResult =
  | { ok: true; value?: Record<string, unknown> }
  | { ok: false; error?: { code?: string; message?: string } };

/** Same wire call retrace's own action row makes; never throws. */
export async function callRetraceOp(op: 'recall' | 'editAndResend', payload: Record<string, unknown>): Promise<RetraceOpResult> {
  const config = readRetraceConfig();
  try {
    const res = await fetch(`/api/plugins/retrace/${op}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-retrace-config': JSON.stringify({ versioning: config.versioning, git: config.git, retentionLimit: config.retentionLimit }),
      },
      body: JSON.stringify(payload),
    });
    if (res.status < 200 || res.status >= 300) return { ok: false, error: { message: `HTTP ${res.status}` } };
    return await res.json() as RetraceOpResult;
  } catch (error) {
    return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } };
  }
}
