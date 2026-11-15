import { describe, expect, it } from 'vitest';
import { generateCodes, AMBIGUOUS_CHARS, MAX_COUNT, MIN_LENGTH } from '../src/legacy/code-generator.js';

function codePoints(value: string): string[] {
  return Array.from(value);
}

describe('generateCodes — random mode', () => {
  it('generates the requested number of unique alphanumeric codes of the requested length', () => {
    const codes = generateCodes({ count: 200, length: 16 });
    expect(codes).toHaveLength(200);
    expect(new Set(codes).size).toBe(200);
    for (const code of codes) {
      expect(codePoints(code)).toHaveLength(16);
      expect(code).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it('removes easily confused characters by default', () => {
    const codes = generateCodes({ count: 300, length: 24 });
    const joined = codes.join('');
    for (const ambiguous of AMBIGUOUS_CHARS) {
      expect(joined.includes(ambiguous)).toBe(false);
    }
  });

  it('can keep ambiguous characters when explicitly requested', () => {
    const codes = generateCodes({ count: 100, length: 32, avoidAmbiguous: false });
    for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('honours named charsets', () => {
    const numeric = generateCodes({ count: 50, length: 8, charset: 'numeric' });
    // 0 and 1 are ambiguous and stripped, so only 2-9 remain.
    for (const code of numeric) expect(code).toMatch(/^[2-9]{8}$/);

    const upper = generateCodes({ count: 50, length: 6, charset: 'upper' });
    for (const code of upper) expect(code).toMatch(/^[A-HJ-NP-Z]{6}$/); // no O / I

    const hex = generateCodes({ count: 50, length: 10, charset: 'hex' });
    for (const code of hex) expect(code).toMatch(/^[2-9a-f]{10}$/); // no 0 / 1
  });

  it('defaults to 16 characters when length is omitted', () => {
    for (const code of generateCodes({ count: 5 })) expect(codePoints(code)).toHaveLength(16);
  });
});

describe('generateCodes — pattern mode', () => {
  it('uses the custom charset, length, prefix and suffix', () => {
    const codes = generateCodes({
      count: 40,
      mode: 'pattern',
      length: 6,
      charset: 'custom',
      customCharset: 'ABC',
      prefix: 'VIP-',
      suffix: '-X',
    });
    expect(codes).toHaveLength(40);
    expect(new Set(codes).size).toBe(40);
    for (const code of codes) {
      expect(code).toMatch(/^VIP-[ABC]{6}-X$/);
      expect(codePoints(code)).toHaveLength(4 + 6 + 2);
    }
  });

  it('accepts a custom charset in pattern mode without charset=custom', () => {
    const codes = generateCodes({ count: 20, mode: 'pattern', length: 5, customCharset: 'xy' });
    for (const code of codes) expect(code).toMatch(/^[xy]{5}$/);
  });

  it('strips ambiguous characters from custom charsets by default', () => {
    const codes = generateCodes({ count: 20, mode: 'pattern', length: 30, customCharset: 'A0O1IlB' });
    for (const code of codes) expect(code).toMatch(/^[AB]{30}$/);
  });

  it('keeps explicit affixes outside the random body', () => {
    const codes = generateCodes({ count: 10, mode: 'pattern', length: 4, customCharset: '01', prefix: 'P', suffix: 'S', avoidAmbiguous: false });
    for (const code of codes) expect(code).toMatch(/^P[01]{4}S$/);
  });
});

describe('generateCodes — validation', () => {
  it('rejects a count outside 1..5000', () => {
    expect(() => generateCodes({ count: 0 })).toThrow(/生成数量/);
    expect(() => generateCodes({ count: -1 })).toThrow(/生成数量/);
    expect(() => generateCodes({ count: MAX_COUNT + 1 })).toThrow(/生成数量/);
    expect(() => generateCodes({ count: 1.5 })).toThrow(/生成数量/);
  });

  it('rejects an invalid length', () => {
    expect(() => generateCodes({ count: 1, length: 3 })).toThrow(/长度/);
    expect(() => generateCodes({ count: 1, length: 65 })).toThrow(/长度/);
    expect(() => generateCodes({ count: 1, length: 4.5 })).toThrow(/长度/);
  });

  it('rejects an unknown mode or charset', () => {
    expect(() => generateCodes({ count: 1, mode: 'template' as never })).toThrow(/生成模式/);
    expect(() => generateCodes({ count: 1, charset: 'bogus' })).toThrow(/字符集/);
  });

  it('requires a custom charset in custom mode', () => {
    expect(() => generateCodes({ count: 1, charset: 'custom' })).toThrow(/custom_charset/);
    expect(() => generateCodes({ count: 1, charset: 'custom', customCharset: '   ' })).toThrow(/custom_charset/);
  });

  it('rejects charsets that collapse to fewer than two characters', () => {
    expect(() => generateCodes({ count: 1, charset: 'custom', customCharset: '0O1Il' })).toThrow(/至少需要包含 2 个/);
  });

  it('rejects affixes containing whitespace or control characters', () => {
    expect(() => generateCodes({ count: 1, prefix: 'VIP ' })).toThrow(/前缀/);
    expect(() => generateCodes({ count: 1, suffix: 'A\tB' })).toThrow(/后缀/);
    expect(() => generateCodes({ count: 1, prefix: 'X'.repeat(33) })).toThrow(/前缀/);
  });

  it('rejects a code space smaller than the requested count', () => {
    // numeric minus 0/1 leaves 8 chars; 8^4 = 4096 < 5000.
    expect(() => generateCodes({ count: 5000, length: 4, charset: 'numeric' })).toThrow(/空间不足/);
    expect(() => generateCodes({ count: 17, length: 4, mode: 'pattern', customCharset: 'AB' })).toThrow(/空间不足/);
    // 16 codes exactly fit the 2^4 space.
    expect(generateCodes({ count: 16, length: 4, mode: 'pattern', customCharset: 'AB' })).toHaveLength(16);
  });

  it('MIN_LENGTH matches the documented lower bound', () => {
    expect(MIN_LENGTH).toBe(4);
  });
});
