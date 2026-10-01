import { LegacyV1Adapter, LegacyV2Adapter, UnknownLegacyAdapter } from './adapters.js';
import type { LegacyAdapterStatic } from './adapter.js';

/**
 * Port of AdapterRegistry: detects the best legacy adapter for a given
 * column set. Order matters (V1 first, then V2); falls back to the
 * UnknownLegacy adapter, which refuses to guess.
 */
export const ADAPTERS: readonly LegacyAdapterStatic[] = [
  LegacyV1Adapter.metadata,
  LegacyV2Adapter.metadata,
];

export function detectAdapter(columns: readonly string[]): LegacyAdapterStatic {
  for (const adapter of ADAPTERS) {
    if (adapter.supports(columns)) return adapter;
  }
  return UnknownLegacyAdapter.metadata;
}
