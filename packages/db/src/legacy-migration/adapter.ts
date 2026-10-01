import type { Row } from '../legacy/shared.js';
import type { CryptoService } from '../legacy/crypto.js';

/**
 * Port of VoiceHubPay\Migration\Legacy\Adapters\LegacyAdapter: the contract
 * every legacy adapter implements.
 */
export interface LegacyAdapter {
  /** Map one legacy row to the new afdian_orders row shape. */
  mapRow(legacy: Row, crypto: CryptoService): Row;
}

/** Static adapter metadata (the PHP static methods on the adapter classes). */
export interface LegacyAdapterStatic {
  name(): string;
  /** Whether this adapter can read a table with the given column list. */
  supports(columns: readonly string[]): boolean;
  /** The legacy amount column name (for pre-migration stats). */
  amountColumn(): string;
  /** The legacy voicehub status column name. */
  voicehubColumn(): string;
  /** Construct the row-mapping instance for this adapter. */
  create(): LegacyAdapter;
}
