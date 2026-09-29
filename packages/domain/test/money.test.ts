import { describe, expect, it } from 'vitest';
import { afdianDeliveryKey, shopDeliveryKey } from '../src/index.js';

describe('delivery idempotency keys', () => {
  it('preserves the documented source-specific key format', () => {
    expect(shopDeliveryKey('VH123', 2).value).toBe('shop:VH123:2');
    expect(afdianDeliveryKey('original-trade-code').value).toBe('afdian:original-trade-code');
  });
});
