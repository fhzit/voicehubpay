export type Cents = number & { readonly __brand: 'Cents' };

/** Parse a base-10 monetary amount without binary floating-point arithmetic. */
export function centsFromDecimal(value: string): Cents {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new RangeError(`Invalid monetary amount: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new RangeError('Monetary amount exceeds safe integer range');
  return (sign === '-' ? -cents : cents) as Cents;
}

export function formatCents(value: Cents | number): string {
  if (!Number.isSafeInteger(value)) throw new RangeError('Cents must be a safe integer');
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}
