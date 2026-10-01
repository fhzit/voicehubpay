/**
 * Port of VoiceHubPay\Support\Money: safe decimal-string <-> integer cents.
 * NEVER uses `Number(value) * 100` on the raw string.
 */
export function toCents(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('金额必须为安全整数');
    return value; // Assume already cents.
  }
  let raw = value.trim();
  if (raw === '') throw new RangeError('金额为空');
  // Strip thousands separators and whitespace.
  raw = raw.replace(/[, \u00A0]/g, '');
  const match = /^-?(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw new RangeError(`无效的金额格式: ${raw}`);
  const negative = raw.startsWith('-');
  const whole = match[1].replace(/^0+/, '');
  const frac = (match[2] ?? '').padEnd(2, '0');
  const cents = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) throw new RangeError('金额超出安全整数范围');
  return negative ? -cents : cents;
}

export function format(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('Cents must be a safe integer');
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}
