export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed';
export type DeliveryStatus = 'pending' | 'success' | 'failed';
export type OrderSource = 'shop' | 'afdian';
export interface IdempotencyKey { readonly value: string }

export function shopDeliveryKey(orderNo: string, unitNo: number): IdempotencyKey {
  if (!orderNo || !Number.isSafeInteger(unitNo) || unitNo < 1) throw new RangeError('Invalid shop delivery identity');
  return { value: `shop:${orderNo}:${unitNo}` };
}
export function afdianDeliveryKey(outTradeNo: string): IdempotencyKey {
  if (!outTradeNo) throw new RangeError('out_trade_no is required');
  return { value: `afdian:${outTradeNo}` };
}
