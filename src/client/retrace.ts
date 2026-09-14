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

/**
 * Merge a patch into the shared `dsh-retrace:config` block and persist it back
 * to the same key (storage layout stays identical — dsh-retrace's own settings
 * UI reads and writes this key too). Unknown fields survive because the base is
 * the fully-resolved config object, not a re-serialized whitelist. Returns the
 * merged config so the caller can re-render without re-reading storage.
 */
export function writeRetraceConfig(patch: Partial<RetraceConfig>): RetraceConfig {
  const next = { ...readRetraceConfig(), ...patch };
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode / quota): the in-memory state still applies.
  }
  return next;
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

/** Node payload shape touched by {@link computeShadowPlan} across all kinds. */
interface ShadowRelevantData {
  seq?: unknown;
  compact?: unknown;
  op?: unknown;
  text?: unknown;
  shadowedSeqs?: unknown;
  root?: { seq?: unknown };
  closing?: { finalNode?: { seq?: unknown } };
}

/**
 * Change key for {@link computeShadowPlan}'s output over a node store.
 *
 * `ChatNodeStore` keeps a reference-stable identity while its contents hydrate,
 * so a `useMemo` keyed on the store never sees content-only updates (a marker
 * arriving with its payload filled in later would keep a stale plan). The
 * signature is a plain string, so React's `Object.is` comparison re-renders /
 * recomputes only when something the plan actually reads changed — streaming
 * assistant text does not.
 */
export function shadowPlanSignature(nodes: ChatNodes): string {
  const parts: string[] = [];
  for (const node of nodes.values()) {
    parts.push(node.key, node.kind, typeof node.anchorSeq === 'number' ? String(node.anchorSeq) : '');
    const data = node.data as ShadowRelevantData | undefined;
    if (node.kind === 'user' || node.kind === 'steering') {
      parts.push(typeof data?.seq === 'number' ? String(data.seq) : '');
    } else if (node.kind === 'recall-marker') {
      parts.push(
        data?.compact === true ? 'c' : '',
        typeof data?.op === 'string' ? data.op : '',
        typeof data?.seq === 'number' ? String(data.seq) : '',
        typeof data?.text === 'string' ? data.text : '',
        Array.isArray(data?.shadowedSeqs) ? data.shadowedSeqs.join(',') : '',
      );
    } else if (node.kind === 'tool-call') {
      parts.push(typeof data?.root?.seq === 'number' ? String(data.root.seq) : '');
    } else if (node.kind === 'turn-tail') {
      parts.push(typeof data?.closing?.finalNode?.seq === 'number' ? String(data.closing.finalNode.seq) : '');
    }
  }
  return parts.join('\u0001');
}

/** One recalled row resolved from the live node store for a marker's audit list. */
export interface ShadowedRecordSummary {
  /** Durable message seq the marker shadowed. */
  readonly seq: number;
  /** Message timestamp when the resolved node carries one, else null. */
  readonly time: number | null;
  /** Plain-text excerpt of the recalled message; empty when unresolved. */
  readonly text: string;
  /** Whether a live node still holds this seq (recalled rows stay as an audit trail). */
  readonly resolved: boolean;
}

/** Payload fields the recalled-row resolver reads across node kinds. */
interface RecordSourceData {
  seq?: unknown;
  time?: unknown;
  content?: unknown;
  blocks?: unknown;
  closing?: { blocks?: unknown; finalNode?: { seq?: unknown } };
  root?: { seq?: unknown };
}

/** Durable seq a real message row carries, mirroring `hiddenKeysFor` resolution. */
function recordSourceSeq(node: ChatConversationViewNode, data: RecordSourceData | undefined): number | null {
  if (node.kind === 'user' || node.kind === 'steering') return typeof data?.seq === 'number' ? data.seq : null;
  if (node.kind === 'tool-call') return typeof data?.root?.seq === 'number' ? data.root.seq : null;
  if (node.kind === 'turn-tail') return typeof data?.closing?.finalNode?.seq === 'number' ? data.closing.finalNode.seq : null;
  if (typeof node.anchorSeq !== 'number') return null;
  // Pseudo rows anchor at half seqs (retrace-reference uses `seq - 0.5`); map
  // the anchor back to its integer seq before matching.
  return node.anchorSeq % 1 === 0 ? node.anchorSeq : Math.ceil(node.anchorSeq);
}

/** Text blocks of one message payload; `type` on user content, `kind` on assistant blocks. */
function recordTextBlocks(source: unknown, key: 'type' | 'kind'): string[] {
  if (!Array.isArray(source)) return [];
  const parts: string[] = [];
  for (const block of source) {
    if (typeof block !== 'object' || block === null) continue;
    const record = block as { type?: unknown; kind?: unknown; text?: unknown };
    if (record[key] !== 'text' || typeof record.text !== 'string') continue;
    parts.push(record.text);
  }
  return parts;
}

/** First content-bearing representation of a recalled row (user content, then assistant blocks). */
function recordTextOf(data: RecordSourceData | undefined): string {
  for (const [source, key] of [
    [data?.content, 'type'],
    [data?.blocks, 'kind'],
    [data?.closing?.blocks, 'kind'],
  ] as const) {
    const text = recordTextBlocks(source, key).join('\n');
    if (text.length > 0) return text;
  }
  return '';
}

/** Richer payloads win when several nodes share one seq (user > assistant-step > turn-tail). */
function recordPriority(kind: string): number {
  if (kind === 'user' || kind === 'steering') return 3;
  if (kind === 'assistant-step') return 2;
  if (kind === 'turn-tail') return 1;
  return 0;
}

/**
 * Resolve a marker's `shadowedSeqs` into per-row previews for its expandable
 * audit list. Recalled rows stay in the node store, so their summary and time
 * are read back from the live nodes; a seq whose node left the loaded window is
 * reported as unresolved (the caller renders a placeholder) instead of dropped.
 *
 * Order follows `shadowedSeqs` (the audit order), duplicates collapse, and
 * pseudo rows (`user-actions` / `retrace-reference` / `recall-marker`) are
 * skipped so a reference row cannot shadow its own target message.
 */
export function shadowedRecordSummaries(nodes: ChatNodes, seqs: readonly unknown[]): ShadowedRecordSummary[] {
  const wanted: number[] = [];
  const unique = new Set<number>();
  for (const value of seqs) {
    if (typeof value !== 'number' || unique.has(value)) continue;
    unique.add(value);
    wanted.push(value);
  }
  if (wanted.length === 0) return [];

  const best = new Map<number, { data: RecordSourceData | undefined; priority: number }>();
  for (const node of nodes.values()) {
    if (PSEUDO_KINDS.has(node.kind)) continue;
    const data = node.data as RecordSourceData | undefined;
    const seq = recordSourceSeq(node, data);
    if (seq === null || !unique.has(seq)) continue;
    const priority = recordPriority(node.kind);
    const current = best.get(seq);
    if (current === undefined || priority > current.priority) best.set(seq, { data, priority });
  }

  return wanted.map((seq): ShadowedRecordSummary => {
    const found = best.get(seq);
    if (found === undefined) return { seq, time: null, text: '', resolved: false };
    return {
      seq,
      time: typeof found.data?.time === 'number' ? found.data.time : null,
      text: recordTextOf(found.data),
      resolved: true,
    };
  });
}

/** Collapsed original-input summary length, in characters. */
const ORIGINAL_INPUT_PREVIEW_LIMIT = 80;

/**
 * Collapsed single-line summary for the pre-edit reference block: its first
 * non-empty line, whitespace-collapsed and clamped with an ellipsis. Kept pure
 * so the reading width never has to be measured to render the folded row.
 */
export function originalInputPreview(text: string, limit: number = ORIGINAL_INPUT_PREVIEW_LIMIT): string {
  const line = text.split(/\r?\n/).find(value => value.trim().length > 0) ?? '';
  const collapsed = line.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, Math.max(0, limit)).trimEnd()}…`;
}

