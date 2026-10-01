import type { Row } from '../legacy/shared.js';
import type { CryptoService } from '../legacy/crypto.js';
import { toCents } from '../legacy/money.js';
import type { LegacyAdapter, LegacyAdapterStatic } from './adapter.js';

/**
 * Port of LegacyV1Adapter — the original voicehubpay schema:
 *   afdian_orders(id, order_no, afdian_user_id, buyer_name, amount,
 *   status, voicehub_status, voicehub_response, last_error, raw_payload,
 *   created_at, updated_at)
 *
 * KEY RULE: order_no IS the Afdian out_trade_no and must be preserved
 * VERBATIM (no truncation, no numeric conversion, no prefix/suffix).
 */
export class LegacyV1Adapter implements LegacyAdapter {
  static readonly metadata: LegacyAdapterStatic = {
    name: () => 'LegacyV1',
    supports: (columns) => columns.includes('order_no') && columns.includes('amount'),
    amountColumn: () => 'amount',
    voicehubColumn: () => 'voicehub_status',
    create: () => new LegacyV1Adapter(),
  };

  mapRow(legacy: Row, _crypto: CryptoService): Row {
    const outTradeNo = String(legacy.order_no ?? '');
    const amountRaw = String(legacy.amount ?? '0');
    let amountCents: number;
    try {
      amountCents = toCents(amountRaw);
    } catch {
      // Same numeric fallback as the PHP baseline; NaN-safe.
      const scaled = Math.round(Number(amountRaw) * 100);
      amountCents = Number.isFinite(scaled) ? scaled : 0;
    }

    const vhStatusRaw = String(legacy.voicehub_status ?? 'pending').toLowerCase();
    const vhStatus = vhStatusRaw === 'created' || vhStatusRaw === 'success' ? 'success' : vhStatusRaw === 'failed' ? 'failed' : 'pending';

    const created = String(legacy.created_at ?? new Date().toISOString());
    const updated = String(legacy.updated_at ?? created);

    return {
      out_trade_no: outTradeNo,
      trade_no: String(legacy.trade_no ?? ''),
      user_id: String(legacy.afdian_user_id ?? ''),
      buyer_name: String(legacy.buyer_name ?? ''),
      plan_id: String(legacy.plan_id ?? ''),
      sku_detail: String(legacy.sku_detail ?? ''),
      amount_cents: amountCents,
      status: String(legacy.status ?? 'paid'),
      raw_payload: String(legacy.raw_payload ?? '[]'),
      voicehub_status: vhStatus,
      voicehub_attempts: vhStatus === 'failed' ? 1 : 0,
      voicehub_last_error: (legacy.last_error as string | null | undefined) ?? null,
      created_at: created,
      paid_at: created,
      processed_at: vhStatus === 'success' || vhStatus === 'failed' ? created : null,
      updated_at: updated,
    };
  }
}

/**
 * Port of LegacyV2Adapter — a later legacy schema that already used
 * out_trade_no + amount_cents naming. out_trade_no is preserved verbatim.
 */
export class LegacyV2Adapter implements LegacyAdapter {
  /** Captured column list for amountColumn resolution (PHP static $columns). */
  static columns: string[] | null = null;

  static readonly metadata: LegacyAdapterStatic = {
    name: () => 'LegacyV2',
    supports: (columns) => columns.includes('out_trade_no') && !columns.includes('order_no'),
    amountColumn: () => (LegacyV2Adapter.columns?.includes('amount_cents') === true ? 'amount_cents' : 'amount'),
    voicehubColumn: () => 'voicehub_status',
    create: () => new LegacyV2Adapter(),
  };

  static setColumns(columns: readonly string[]): void {
    LegacyV2Adapter.columns = [...columns];
  }

  mapRow(legacy: Row, _crypto: CryptoService): Row {
    const outTradeNo = String(legacy.out_trade_no ?? '');
    let amountCents: number;
    if (legacy.amount_cents !== undefined && legacy.amount_cents !== null) {
      amountCents = Number(legacy.amount_cents);
    } else {
      try {
        amountCents = toCents(String(legacy.amount ?? '0'));
      } catch {
        // Same numeric fallback as the PHP baseline; NaN-safe.
        const scaled = Math.round(Number(legacy.amount ?? 0) * 100);
        amountCents = Number.isFinite(scaled) ? scaled : 0;
      }
    }

    const vhStatusRaw = String(legacy.voicehub_status ?? 'pending').toLowerCase();
    const vhStatus = vhStatusRaw === 'created' || vhStatusRaw === 'success' ? 'success' : vhStatusRaw === 'failed' ? 'failed' : 'pending';

    const created = String(legacy.created_at ?? new Date().toISOString());
    return {
      out_trade_no: outTradeNo,
      trade_no: String(legacy.trade_no ?? ''),
      user_id: String(legacy.user_id ?? ''),
      buyer_name: String(legacy.buyer_name ?? ''),
      remark: String(legacy.remark ?? ''),
      plan_id: String(legacy.plan_id ?? ''),
      sku_detail: String(legacy.sku_detail ?? ''),
      amount_cents: amountCents,
      status: String(legacy.status ?? 'paid'),
      raw_payload: String(legacy.raw_payload ?? '[]'),
      voicehub_status: vhStatus,
      voicehub_attempts: vhStatus === 'failed' ? 1 : 0,
      voicehub_last_error: (legacy.voicehub_last_error as string | null | undefined) ?? (legacy.last_error as string | null | undefined) ?? null,
      created_at: created,
      paid_at: created,
      processed_at: vhStatus === 'success' || vhStatus === 'failed' ? created : null,
      updated_at: String(legacy.updated_at ?? created),
    };
  }
}

/**
 * Port of UnknownLegacyAdapter: refuses to migrate schemas we cannot
 * recognize. Never guesses field mappings.
 */
export class UnknownLegacyAdapter implements LegacyAdapter {
  static readonly metadata: LegacyAdapterStatic = {
    name: () => 'UnknownLegacy',
    supports: () => false,
    amountColumn: () => 'amount',
    voicehubColumn: () => 'voicehub_status',
    create: () => new UnknownLegacyAdapter(),
  };

  mapRow(_legacy: Row, _crypto: CryptoService): Row {
    throw new Error('Unknown legacy schema — refusing to guess field mappings.');
  }
}
