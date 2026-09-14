import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  READER_DENSITY_OPTIONS, READER_FONT_OPTIONS, READER_LINE_WIDTH_OPTIONS, READER_SETTINGS_DEFAULTS,
  normalizeDensity, normalizeFontSize, normalizeLineWidth, normalizeReaderSettings, readerFontMode, readerSettingVars,
} from '../src/client/reader-settings.ts';
import { readRetraceConfig, writeRetraceConfig } from '../src/client/retrace.ts';

/** Minimal in-memory Storage stand-in for the retrace config block. */
function installStorage(seed: Record<string, string> = {}): Map<string, string> {
  const map = new Map<string, string>(Object.entries(seed));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => { map.set(key, String(value)); },
      removeItem: (key: string) => { map.delete(key); },
    },
  });
  return map;
}

test('reader settings defaults resolve to no override at all', () => {
  assert.deepEqual(normalizeReaderSettings({}), { fontSize: 'auto', lineWidth: 'standard', density: 'standard' });
  // Zero-config invariant: the standard density reproduces the stylesheet
  // fallbacks and no width/font variable is emitted, so the rendered result is
  // byte-identical to a build without the settings feature.
  assert.deepEqual(readerSettingVars(READER_SETTINGS_DEFAULTS), {
    '--bd-turn-column-gap': '22px',
    '--bd-turn-turn-gap': '12px',
  });
  assert.equal(readerFontMode(READER_SETTINGS_DEFAULTS.fontSize), 'auto');
});

test('persisted junk falls back to the defaults instead of breaking the view', () => {
  assert.equal(normalizeFontSize(99), 'auto');
  assert.equal(normalizeFontSize('16'), 'auto');
  assert.equal(normalizeLineWidth('wide'), 'standard');
  assert.equal(normalizeDensity(null), 'standard');
  assert.equal(normalizeFontSize(13), 13);
  assert.equal(normalizeLineWidth('relaxed'), 'relaxed');
  assert.equal(normalizeDensity('compact'), 'compact');
});

test('an explicit font preset mirrors the host body-size formula', () => {
  const vars = readerSettingVars({ fontSize: 17, lineWidth: 'standard', density: 'standard' });
  assert.equal(vars['--bd-reading-font-size'], '17px');
  assert.equal(vars['--bd-reading-delta'], '3px');
  assert.equal(Number(vars['--bd-reading-scale']), 17 / 14);
  assert.equal(readerFontMode(17), 'fixed');
  // The 14px host default maps to a zero delta.
  assert.equal(readerSettingVars({ fontSize: 14 })['--bd-reading-delta'], '0px');
});

test('width presets only emit a variable when they differ from the host chain', () => {
  assert.equal(readerSettingVars({ lineWidth: 'compact' })['--bd-reading-width'], '620px');
  assert.equal(readerSettingVars({ lineWidth: 'relaxed' })['--bd-reading-width'], '900px');
  assert.equal('--bd-reading-width' in readerSettingVars({ lineWidth: 'standard' }), false);
});

test('density presets widen or tighten the turn gaps', () => {
  assert.deepEqual(readerSettingVars({ density: 'compact' }), { '--bd-turn-column-gap': '12px', '--bd-turn-turn-gap': '6px' });
  assert.deepEqual(readerSettingVars({ density: 'relaxed' }), { '--bd-turn-column-gap': '36px', '--bd-turn-turn-gap': '20px' });
});

test('option tables expose the documented presets in order', () => {
  assert.deepEqual(READER_FONT_OPTIONS.map(option => option.value), ['auto', 13, 14, 15, 16, 17]);
  assert.deepEqual(READER_LINE_WIDTH_OPTIONS.map(option => option.value), ['compact', 'standard', 'relaxed']);
  assert.deepEqual(READER_DENSITY_OPTIONS.map(option => option.value), ['compact', 'standard', 'relaxed']);
});

test('writeRetraceConfig writes back to the shared dsh-retrace:config key', () => {
  const map = installStorage();
  const next = writeRetraceConfig({ showOriginalInput: false });
  assert.equal(next.showOriginalInput, false);
  assert.equal(next.hideShadowed, true);
  const raw = JSON.parse(map.get('dsh-retrace:config')!);
  assert.equal(raw.showOriginalInput, false);
  assert.deepEqual(readRetraceConfig(), next);
});

test('writeRetraceConfig preserves fields owned by the retrace plugin', () => {
  installStorage({
    'dsh-retrace:config': JSON.stringify({ showOriginalInput: true, hideShadowed: true, versioning: false, retentionLimit: 7, custom: 'kept' }),
  });
  writeRetraceConfig({ hideShadowed: false });
  const stored = JSON.parse((globalThis as unknown as { localStorage: { getItem(key: string): string | null } }).localStorage.getItem('dsh-retrace:config')!);
  assert.equal(stored.versioning, false);
  assert.equal(stored.retentionLimit, 7);
  assert.equal(stored.custom, 'kept');
  assert.equal(stored.hideShadowed, false);
  assert.equal(readRetraceConfig().versioning, false);
});

test('a legacy-only config still reads through the legacy key until written', () => {
  const map = installStorage({ 'dsh-message-editor:config': JSON.stringify({ showOriginalInput: false, hideShadowed: false }) });
  assert.equal(readRetraceConfig().showOriginalInput, false);
  writeRetraceConfig({ hideShadowed: true });
  // The write lands on the primary key (the retrace plugin's own), leaving the
  // legacy key untouched and carrying its values forward into the merged block.
  assert.ok(map.has('dsh-retrace:config'));
  assert.ok(map.has('dsh-message-editor:config'));
  assert.equal(JSON.parse(map.get('dsh-retrace:config')!).showOriginalInput, false);
  assert.equal(readRetraceConfig().hideShadowed, true);
});
