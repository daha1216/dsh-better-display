import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client';

/**
 * Reading-view interop with the installed dsh-retrace plugin (0.4.x wire contract).
 *
 * The reader re-implements the display-side pieces of retrace's client instead
 * of importing its bundle: the localStorage preference block and the
 * shadowed-row hide plan. Operation chips (编辑/撤回) are NOT rendered here —
 * dsh-retrace 0.4.22+ injects its own ghost chips into the reader view.
 * Everything here is defensive — when dsh-retrace is absent there are no
 * `user-actions` nodes and no markers, so nothing changes.
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
  /**
   * Pre-edit original text keyed by the seq of the user message that replaced it
   * (the first user message after the `edit` marker).
   *
   * Retrace keeps the pre-edit text on the marker itself (`recall-marker.data.text`);
   * its `retrace-reference` node carries the referenced message's **own** current
   * content, so an "original input" row must read the marker — reading the
   * reference node's payload would print a block under every user message.
   */
  readonly editOriginalTexts: ReadonlyMap<number, string>;
}

const EMPTY_PLAN: RetraceShadowPlan = {
  hiddenKeys: new Set(), shadowedSeqs: new Set(), degradedMarkerKeys: new Set(), editOriginalTexts: new Map(),
};

/** Resolve each `edit` marker's original text onto the user message that replaced it. */
function editOriginalTextsFor(
  editMarkers: readonly { seq: number; text: string }[],
  userSeqs: readonly number[],
): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  // Ascending marker seq: a later edit of the same message overwrites the earlier original.
  for (const marker of [...editMarkers].sort((a, b) => a.seq - b.seq)) {
    let replaced: number | null = null;
    for (const seq of userSeqs) {
      if (seq <= marker.seq) continue;
      if (replaced === null || seq < replaced) replaced = seq;
    }
    if (replaced !== null) out.set(replaced, marker.text);
  }
  return out;
}

export function computeShadowPlan(nodes: ChatNodes, config: RetraceConfig): RetraceShadowPlan {
  const markers: { key: string; seqs: readonly number[] }[] = [];
  const editMarkers: { seq: number; text: string }[] = [];
  const userSeqs: number[] = [];
  for (const node of nodes.values()) {
    if (node.kind === 'user' || node.kind === 'steering') {
      const seq = (node.data as { seq?: unknown } | undefined)?.seq;
      if (typeof seq === 'number') userSeqs.push(seq);
      continue;
    }
    if (node.kind !== 'recall-marker') continue;
    const data = node.data as { compact?: boolean; shadowedSeqs?: unknown; op?: unknown; text?: unknown; seq?: unknown } | undefined;
    if (data?.compact) continue;
    if (data?.op === 'edit' && typeof data.seq === 'number' && typeof data.text === 'string' && data.text.length > 0) {
      editMarkers.push({ seq: data.seq, text: data.text });
    }
    const seqs = Array.isArray(data?.shadowedSeqs)
      ? data.shadowedSeqs.filter((value): value is number => typeof value === 'number')
      : [];
    markers.push({ key: node.key, seqs });
  }
  const editOriginalTexts = editOriginalTextsFor(editMarkers, userSeqs);
  if (markers.length === 0) return { ...EMPTY_PLAN, editOriginalTexts };

  const shadowedSeqs = new Set<number>();
  for (const marker of markers) for (const seq of marker.seqs) shadowedSeqs.add(seq);
  if (!config.hideShadowed) return { hiddenKeys: new Set(), shadowedSeqs, degradedMarkerKeys: new Set(), editOriginalTexts };

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
  return { hiddenKeys, shadowedSeqs, degradedMarkerKeys, editOriginalTexts };
}

