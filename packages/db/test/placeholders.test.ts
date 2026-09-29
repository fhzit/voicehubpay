import { describe, expect, it } from 'vitest';
import { placeholders } from '../src/index.js';

describe('database placeholders', () => {
  it('uses dialect-safe parameter markers', () => {
    expect(placeholders('sqlite', 3)).toBe('?, ?, ?');
    expect(placeholders('pgsql', 2, 4)).toBe('$4, $5');
  });
});
