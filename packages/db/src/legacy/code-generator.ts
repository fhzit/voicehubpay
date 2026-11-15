import { randomInt } from 'node:crypto';

/**
 * Inventory card-code generator (pure functions, no database access).
 *
 * The generated codes are plaintext secrets; the caller is responsible for
 * encrypting + hashing them exactly like a manual import (see
 * `insertGeneratedCodes` in inventory-repository.ts).
 *
 * Two modes:
 *   - `random`  — random alphanumeric body, optional prefix/suffix
 *   - `pattern` — random body drawn from a caller-supplied character set,
 *                 optional prefix/suffix (length applies to the body only)
 *
 * By default the easily confused characters `0 O 1 I l` are removed from the
 * alphabet. Uniqueness inside one batch is guaranteed by rejection sampling;
 * the available code space is checked up front so an impossible request fails
 * with a clear error instead of looping forever.
 */

export type CodeMode = 'random' | 'pattern';

export type CharsetName = 'alnum' | 'alpha' | 'numeric' | 'upper' | 'lower' | 'hex' | 'custom';

export interface GenerateCodesOptions {
  /** Number of codes to generate, 1..5000. */
  count: number;
  /** Generation mode, defaults to `random`. */
  mode?: CodeMode;
  /** Body length in code points, 4..64. Defaults to 16. */
  length?: number;
  /** Named charset (alnum|alpha|numeric|upper|lower|hex|custom), defaults to alnum. */
  charset?: string;
  /** Literal character set; required when charset is `custom`. */
  customCharset?: string;
  /** Optional fixed prefix (max 32 code points, no whitespace/control chars). */
  prefix?: string;
  /** Optional fixed suffix (max 32 code points, no whitespace/control chars). */
  suffix?: string;
  /** Strip 0/O/1/I/l from the alphabet, defaults to true. */
  avoidAmbiguous?: boolean;
}

export const MIN_COUNT = 1;
export const MAX_COUNT = 5000;
export const MIN_LENGTH = 4;
export const MAX_LENGTH = 64;
export const MAX_AFFIX_LENGTH = 32;

/** Characters that are easy to misread in printed/typed card codes. */
export const AMBIGUOUS_CHARS: readonly string[] = ['0', 'O', '1', 'I', 'l'];

const CHARSETS: Record<Exclude<CharsetName, 'custom'>, string> = {
  alnum: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  numeric: '0123456789',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  hex: '0123456789abcdef',
};

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function validateAffix(value: string, label: string): void {
  if (codePointLength(value) > MAX_AFFIX_LENGTH) {
    throw new RangeError(`${label}长度不能超过 ${MAX_AFFIX_LENGTH} 个字符。`);
  }
  if (/[\s\u0000-\u001F\u007F]/.test(value)) {
    throw new RangeError(`${label}不能包含空白或控制字符。`);
  }
}

function resolveAlphabet(options: GenerateCodesOptions, mode: CodeMode): string[] {
  const charset = (options.charset ?? 'alnum').trim() || 'alnum';
  let raw: string;

  if (mode === 'pattern' && typeof options.customCharset === 'string' && options.customCharset.trim() !== '') {
    // Pattern mode: an explicit custom charset always wins.
    raw = options.customCharset;
  } else if (charset === 'custom') {
    const custom = options.customCharset?.trim() ?? '';
    if (custom === '') throw new RangeError('自定义字符集模式必须提供 custom_charset。');
    raw = custom;
  } else if (charset in CHARSETS) {
    raw = CHARSETS[charset as Exclude<CharsetName, 'custom'>];
  } else {
    throw new RangeError(`不支持的字符集：${charset}。可选值：${Object.keys(CHARSETS).join('、')}、custom。`);
  }

  const avoid = options.avoidAmbiguous ?? true;
  const unique = Array.from(new Set(Array.from(raw)));
  const alphabet = avoid ? unique.filter((char) => !AMBIGUOUS_CHARS.includes(char)) : unique;

  if (alphabet.length < 2) {
    throw new RangeError('可用字符集至少需要包含 2 个不同的字符（已剔除易混淆字符 0/O/1/I/l）。');
  }
  return alphabet;
}

function codeSpace(alphabetSize: number, length: number): number {
  const size = Math.pow(alphabetSize, length);
  return Number.isFinite(size) && size <= Number.MAX_SAFE_INTEGER ? size : Number.POSITIVE_INFINITY;
}

/**
 * Generate a batch of unique card codes.
 *
 * Throws RangeError for invalid parameters (count/length/mode/charset/affixes,
 * or a code space smaller than `count`), and Error when uniqueness sampling
 * cannot finish within a bounded attempt budget.
 */
export function generateCodes(options: GenerateCodesOptions): string[] {
  const { count } = options;
  if (!isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    throw new RangeError(`生成数量必须是 ${MIN_COUNT} 到 ${MAX_COUNT} 之间的整数。`);
  }

  const length = options.length ?? 16;
  if (!isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    throw new RangeError(`卡密长度必须是 ${MIN_LENGTH} 到 ${MAX_LENGTH} 之间的整数。`);
  }

  const mode = options.mode ?? 'random';
  if (mode !== 'random' && mode !== 'pattern') {
    throw new RangeError(`不支持的生成模式：${String(mode)}。可选值：random、pattern。`);
  }

  const prefix = options.prefix ?? '';
  const suffix = options.suffix ?? '';
  validateAffix(prefix, '前缀');
  validateAffix(suffix, '后缀');

  const totalLength = codePointLength(prefix) + length + codePointLength(suffix);
  if (totalLength > MAX_LENGTH + MAX_AFFIX_LENGTH * 2) {
    throw new RangeError('卡密总长度超出限制。');
  }

  const alphabet = resolveAlphabet(options, mode);
  const capacity = codeSpace(alphabet.length, length);
  if (capacity < count) {
    const printable = capacity === Number.POSITIVE_INFINITY ? '无限' : String(capacity);
    throw new RangeError(`卡密空间不足：当前字符集与长度最多只能生成 ${printable} 条唯一卡密。`);
  }

  const codes = new Set<string>();
  // Rejection sampling. Near-saturation batches need roughly n·H(n) draws;
  // the budget leaves ample headroom while still guaranteeing termination.
  const maxAttempts = Math.max(count * 200, 10_000);
  let attempts = 0;
  while (codes.size < count) {
    if (attempts >= maxAttempts) {
      throw new Error('生成唯一卡密失败，请增大长度或字符集后重试。');
    }
    attempts += 1;
    let body = '';
    for (let index = 0; index < length; index += 1) {
      body += alphabet[randomInt(alphabet.length)];
    }
    codes.add(`${prefix}${body}${suffix}`);
  }

  return Array.from(codes);
}

/** Default export for call sites that prefer a namespace import. */
export default generateCodes;
