export interface LegacyUnderlineMatch {
  /** Source-relative UTF-16 offsets; end and contentEnd are exclusive. */
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  /** Original content bytes represented as a JS string; never trimmed. */
  content: string;
}
export interface LegacyUnderlineOptions {
  fromIndex?: number;
  /** Full original text preceding source, for tokenizer context. */
  prefix?: string;
  /** Compatibility aliases; prefix takes precedence. */
  previousText?: string;
  previousChar?: string;
  insideMath?: boolean;
}
export function findLegacyUnderline(source: string, options?: LegacyUnderlineOptions): LegacyUnderlineMatch | null;
/** Code/math regions in source-relative UTF-16 units; end is exclusive. */
export function legacyUnderlineOpaqueRanges(source: string): Array<{ start: number; end: number }>;
export function mapLegacyUnderline(source: string, mapper: (match: LegacyUnderlineMatch) => string, options?: LegacyUnderlineOptions): string;
