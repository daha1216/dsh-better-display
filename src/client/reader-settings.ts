/**
 * Reading-view appearance preferences: option tables plus the pure resolvers
 * that turn persisted store state into the CSS variables applied on `.root`.
 *
 * Zero-config invariant: the defaults resolve to *no override at all* — no
 * `--bd-reading-width` / `--bd-reading-font-size` is emitted, and the density
 * vars reproduce the stylesheet fallbacks (22px column gap, 12px turn gap), so
 * an untouched store renders exactly like a build without this module.
 *
 * The font presets mirror the host body-size formula
 * (`--dsh-content-font-size` 12–17, default 14: line-height `size + 10`,
 * heading delta `size - 14`, secondary `min(size - 1, max(13, size - 2))`), so
 * an explicit reader size reproduces what the host itself would render at that
 * size. `'auto'` (the default) leaves the host markdown font tokens alone.
 */

/** `'auto'` follows the host DSH body size; the numbers are explicit px presets. */
export type ReaderFontSize = 'auto' | 13 | 14 | 15 | 16 | 17;
export type ReaderLineWidth = 'compact' | 'standard' | 'relaxed';
export type ReaderDensity = 'compact' | 'standard' | 'relaxed';

export interface ReaderSettingsState {
  fontSize: ReaderFontSize;
  lineWidth: ReaderLineWidth;
  density: ReaderDensity;
}

export const READER_FONT_OPTIONS: readonly { value: ReaderFontSize; label: string }[] = [
  { value: 'auto', label: '跟随' },
  { value: 13, label: '13' },
  { value: 14, label: '14' },
  { value: 15, label: '15' },
  { value: 16, label: '16' },
  { value: 17, label: '17' },
];

export const READER_LINE_WIDTH_OPTIONS: readonly { value: ReaderLineWidth; label: string }[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'relaxed', label: '宽松' },
];

export const READER_DENSITY_OPTIONS: readonly { value: ReaderDensity; label: string }[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'relaxed', label: '宽松' },
];

/** Defaults equal current appearance: 'auto' font, standard width, standard density. */
export const READER_SETTINGS_DEFAULTS: ReaderSettingsState = {
  fontSize: 'auto',
  lineWidth: 'standard',
  density: 'standard',
};

/** The host's default body size; the reference for the explicit px presets. */
const HOST_BODY_FONT_SIZE = 14;
/** Current stylesheet values, kept as the density fallbacks. */
const STANDARD_COLUMN_GAP = 22;
const STANDARD_TURN_GAP = 12;

const DENSITY_GAPS: Record<ReaderDensity, { column: number; turn: number }> = {
  compact: { column: 12, turn: 6 },
  standard: { column: STANDARD_COLUMN_GAP, turn: STANDARD_TURN_GAP },
  relaxed: { column: 36, turn: 20 },
};

/** `null` means "keep the host width chain" (the standard preset). */
const LINE_WIDTHS: Record<ReaderLineWidth, string | null> = {
  compact: '620px',
  standard: null,
  relaxed: '900px',
};

function inOptions<T extends string | number>(value: unknown, options: readonly { value: T }[]): value is T {
  return (typeof value === 'string' || typeof value === 'number') && options.some(option => option.value === value);
}

export function normalizeFontSize(value: unknown): ReaderFontSize {
  return inOptions(value, READER_FONT_OPTIONS) ? value : READER_SETTINGS_DEFAULTS.fontSize;
}

export function normalizeLineWidth(value: unknown): ReaderLineWidth {
  return inOptions(value, READER_LINE_WIDTH_OPTIONS) ? value : READER_SETTINGS_DEFAULTS.lineWidth;
}

export function normalizeDensity(value: unknown): ReaderDensity {
  return inOptions(value, READER_DENSITY_OPTIONS) ? value : READER_SETTINGS_DEFAULTS.density;
}

export function normalizeReaderSettings(state: Partial<Record<keyof ReaderSettingsState, unknown>>): ReaderSettingsState {
  return {
    fontSize: normalizeFontSize(state.fontSize),
    lineWidth: normalizeLineWidth(state.lineWidth),
    density: normalizeDensity(state.density),
  };
}

/** CSS hook guarding the host markdown font-token overrides (`auto` = leave host alone). */
export function readerFontMode(value: unknown): 'auto' | 'fixed' {
  return normalizeFontSize(value) === 'auto' ? 'auto' : 'fixed';
}

/** Inline CSS variables for the reader root. Only non-default values are emitted. */
export function readerSettingVars(state: Partial<Record<keyof ReaderSettingsState, unknown>>): Record<string, string> {
  const settings = normalizeReaderSettings(state);
  const gaps = DENSITY_GAPS[settings.density];
  const vars: Record<string, string> = {
    '--bd-turn-column-gap': `${gaps.column}px`,
    '--bd-turn-turn-gap': `${gaps.turn}px`,
  };
  const width = LINE_WIDTHS[settings.lineWidth];
  if (width !== null) vars['--bd-reading-width'] = width;
  if (settings.fontSize !== 'auto') {
    vars['--bd-reading-font-size'] = `${settings.fontSize}px`;
    vars['--bd-reading-delta'] = `${settings.fontSize - HOST_BODY_FONT_SIZE}px`;
    // 12px secondary text (original-input reference) scales by the same ratio.
    vars['--bd-reading-scale'] = String(settings.fontSize / HOST_BODY_FONT_SIZE);
  }
  return vars;
}
