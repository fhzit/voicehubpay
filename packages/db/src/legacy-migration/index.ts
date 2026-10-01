export type { LegacyAdapter, LegacyAdapterStatic } from './adapter.js';
export { LegacyV1Adapter, LegacyV2Adapter, UnknownLegacyAdapter } from './adapters.js';
export { ADAPTERS, detectAdapter } from './adapter-registry.js';
export { LegacySchemaDetector, openSqliteReader, LEGACY_CONFIG_PATH } from './schema-detector.js';
export type { DataDbInfo, LegacyDetectionReport, LegacyReader, VoicehubCounts } from './schema-detector.js';
export { LegacyMigrationService } from './migration-service.js';
export type { DryRunReport, MigrationResult, MigrationVerification } from './migration-service.js';
