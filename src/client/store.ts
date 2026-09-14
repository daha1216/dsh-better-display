import { defineStore } from '@deepseek-ai/dsh-client-store';
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store';
import { READER_SETTINGS_DEFAULTS, type ReaderDensity, type ReaderFontSize, type ReaderLineWidth } from './reader-settings.js';

export interface ReaderState {
  expanded: Record<string, boolean>;
  motion: boolean;
  /** Reading-body font preset; `'auto'` follows the host DSH body size. */
  fontSize: ReaderFontSize;
  /** Reading-body max-width preset. */
  lineWidth: ReaderLineWidth;
  /** Turn-to-turn spacing preset. */
  density: ReaderDensity;
}
type ReaderActions = {
  setExpanded: (draft: ReaderState, key: string, value: boolean) => void;
  setMotion: (draft: ReaderState, value: boolean) => void;
  setFontSize: (draft: ReaderState, value: ReaderFontSize) => void;
  setLineWidth: (draft: ReaderState, value: ReaderLineWidth) => void;
  setDensity: (draft: ReaderState, value: ReaderDensity) => void;
};

export function createReaderStore(): EngineStoreHandle<ReaderState, ReaderActions> {
  return defineStore({
    init: (): ReaderState => ({
      expanded: {},
      motion: true,
      fontSize: READER_SETTINGS_DEFAULTS.fontSize,
      lineWidth: READER_SETTINGS_DEFAULTS.lineWidth,
      density: READER_SETTINGS_DEFAULTS.density,
    }),
    persist: 'dsh.reader.v1',
    actions: {
      setExpanded: (draft, key: string, value: boolean) => { draft.expanded[key] = value; },
      setMotion: (draft, value: boolean) => { draft.motion = value; },
      setFontSize: (draft, value: ReaderFontSize) => { draft.fontSize = value; },
      setLineWidth: (draft, value: ReaderLineWidth) => { draft.lineWidth = value; },
      setDensity: (draft, value: ReaderDensity) => { draft.density = value; },
    },
  });
}
