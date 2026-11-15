/**
 * Dependency surface for the legacy (PHP-parity) admin panel.
 *
 * Every port mirrors the PHP class named in its docblock and stays structural
 * so the SQLite/pgsql repositories in `packages/db/src/legacy` (or lightweight
 * test doubles) can be passed in without adapters.
 */

import type { Clock, SessionStore } from "../auth-legacy/types.js";

/** Legacy-schema row (database/migrations/*.sql). */
export type Row = Record<string, unknown>;

export interface Paginated<T = Row> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

/** Port of VoiceHubPay\Security\CryptoService (encrypt/hash/mask cards). */
export interface AdminCryptoPort {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
  hash(value: string): string;
  mask(value: string): string;
}

/** Key/value settings surfaced by the settings pages (Config->settings()). */
export interface AdminSettingsPort {
  all(): Record<string, string>;
  saveMany(values: Record<string, string>): Promise<void> | void;
  remove?(keys: readonly string[]): Promise<void> | void;
}

/** Port of the App->config accessor used across the admin controllers. */
export interface AdminConfigPort {
  get(key: string, fallback?: string): string;
  bool(key: string, fallback: boolean): boolean;
  int(key: string, fallback: number): number;
  /** Effective entry path honouring a configured secret prefix. */
  authUrl?(route: string): string;
  /** Public base URL (SITE_URL/APP_URL), without trailing slash. */
  appUrl?(): string;
  /** Decrypted secret lookup (SMTP password, API tokens) for placeholders. */
  secret?(key: string, fallback?: string): string;
  /** Persist an encrypted secret (Python SecretStore::set parity). */
  setSecret?(key: string, value: string): Promise<void> | void;
  /** Settings store used by /admin/settings/*; when absent pages are read-only. */
  settings?: AdminSettingsPort;
  reloadSettings?(): Promise<void> | void;
}

/** Port of VoiceHubPay\Repositories\ProductRepository (admin surface). */
export interface AdminProductPort {
  findById(id: number): Promise<Row | null>;
  listAdmin(q?: string, status?: string, categoryId?: number | null, page?: number, perPage?: number): Promise<Paginated<Row>>;
  create(data: Row & { name: string; slug: string }): Promise<Row | null>;
  update(id: number, fields: Row): Promise<void>;
  setStatus(id: number, status: string): Promise<void>;
  deleteOrDisable(id: number): Promise<"deleted" | "disabled">;
  uniqueSlug(name: string, ignoreId?: number | null): Promise<string>;
}

/** Port of VoiceHubPay\Repositories\CategoryRepository. */
export interface AdminCategoryPort {
  listAll(): Promise<Row[]>;
  listActive(): Promise<Row[]>;
  create(name: string, slug: string, sortOrder?: number, status?: string): Promise<Row | null>;
  update(id: number, fields: Row): Promise<void>;
  delete(id: number): Promise<boolean>;
  uniqueSlug(name: string, ignoreId?: number | null): Promise<string>;
}

/** Port of VoiceHubPay\Repositories\InventoryRepository (admin surface). */
export interface AdminInventoryPort {
  findById(id: number): Promise<Row | null>;
  countAvailable(productId: number): Promise<number>;
  stats(productId: number): Promise<{ available: number; reserved: number; sold: number; disabled: number }>;
  totalStats(): Promise<{ available: number; reserved: number; sold: number; disabled: number }>;
  import(productId: number, secrets: readonly string[], crypto: AdminCryptoPort): Promise<{ total: number; imported: number; duplicates: number; invalid: number }>;
  reserve(productId: number, quantity: number, orderId: number, reservedUntil: string, withSecrets?: boolean, crypto?: AdminCryptoPort): Promise<Row[]>;
  releaseForOrder(orderId: number): Promise<number>;
  markSoldForOrder(orderId: number): Promise<number>;
  setDisabled(id: number, disabled: boolean): Promise<void>;
  listForProduct(productId: number, status?: string, q?: string, page?: number, perPage?: number): Promise<Paginated<Row>>;
  listAll(q?: string, page?: number, perPage?: number): Promise<Paginated<Row>>;
}

export interface AdminOrderFilters {
  order_no?: string;
  username?: string;
  product?: string;
  payment_status?: string;
  fulfillment_status?: string;
  abnormal?: boolean | string;
  from?: string;
  to?: string;
}

/** Port of VoiceHubPay\Repositories\OrderRepository (admin surface). */
export interface AdminOrderPort {
  findById(id: number): Promise<Row | null>;
  findByOrderNo(orderNo: string): Promise<Row | null>;
  update(id: number, fields: Row): Promise<void>;
  markPaid(id: number, amountPaidCents: number, gateway: string, confirmationSource: string): Promise<void>;
  items(orderId: number): Promise<Row[]>;
  units(orderId: number): Promise<Row[]>;
  findUnit(unitId: number): Promise<Row | null>;
  updateUnit(unitId: number, fields: Row): Promise<void>;
  countUnitsByStatus(orderId: number): Promise<Record<string, number>>;
  orderWithItems(orderNo: string): Promise<(Row & { items: Row[]; units: Row[] }) | null>;
  listAdmin(filters?: AdminOrderFilters, page?: number, perPage?: number): Promise<Paginated<Row>>;
  listForUser(userId: number, status?: string, q?: string, page?: number, perPage?: number): Promise<Paginated<Row>>;
  listForUserLatest(userId: number, limit?: number): Promise<Row[]>;
  recalcFulfillmentStatus?(orderId: number): Promise<void>;
}

/** Port of VoiceHubPay\Repositories\PaymentTransactionRepository. */
export interface AdminPaymentPort {
  listForOrder(orderId: number): Promise<Row[]>;
  listAdmin(payType?: string, status?: string, q?: string, page?: number, perPage?: number): Promise<Paginated<Row>>;
  markCancelledForOrder(orderId: number): Promise<number>;
  findByMerchantOrderNo?(orderNo: string): Promise<Row | null>;
}

/** Port of VoiceHubPay\Repositories\UserRepository (admin surface). */
export interface AdminUserPort {
  findById(id: number): Promise<Row | null>;
  findByUsername(username: string): Promise<Row | null>;
  update(id: number, fields: Row): Promise<void>;
  setStatus(id: number, status: string): Promise<void>;
  setRole(id: number, role: string): Promise<void>;
  delete(id: number): Promise<void>;
  search(q?: string, status?: string, page?: number, perPage?: number): Promise<Paginated<Row>>;
  superAdminId(): Promise<number | null>;
  isSuperAdmin(id: number): Promise<boolean>;
}

/** Port of VoiceHubPay\Repositories\SocialIdentityRepository (read-only). */
export interface AdminSocialPort {
  listForUser(userId: number): Promise<Row[]>;
}

/** Port of VoiceHubPay\Repositories\FulfillmentUnitRepository (read-only). */
export interface AdminUnitsPort {
  countDeliveredForUser(userId: number): Promise<number>;
}

/** Port of VoiceHubPay\Repositories\AuditLogRepository. */
export interface AdminAuditPort {
  log(
    userId: number | null,
    action: string,
    objectType?: string,
    objectId?: string,
    metadata?: Record<string, unknown>,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<void>;
  list(
    filters?: { action?: string; user_id?: number; object_type?: string; q?: string; from?: string; to?: string },
    page?: number,
    perPage?: number,
  ): Promise<Paginated<Row>>;
  distinctActions(): Promise<string[]>;
}

/** Port of VoiceHubPay\Repositories\VoiceHubDeliveryRepository. */
export interface AdminVoiceHubPort {
  findById(id: number): Promise<Row | null>;
  findByUnitId?(unitId: number): Promise<Row | null>;
  list(filters?: { status?: string; code_source?: string; q?: string; only_failed?: boolean | string }, page?: number, perPage?: number): Promise<Paginated<Row>>;
  recentFailures(limit?: number): Promise<Row[]>;
  stats(): Promise<Record<string, number>>;
  countTodayByStatus(status: string, timeZone?: string): Promise<number>;
  countFailedRetryable(): Promise<number>;
  markFailed?(id: number, error: string, responsePayload?: string): Promise<void>;
}

/** Port of VoiceHubPay\Repositories\AfdianOrderRepository (admin surface). */
export interface AdminAfdianPort {
  findById(id: number): Promise<Row | null>;
  findByOutTradeNo(outTradeNo: string): Promise<Row | null>;
  createIfAbsent(data: Row & { out_trade_no: string }): Promise<{ created: boolean; order: Row | null }>;
  update(id: number, fields: Row): Promise<void>;
  listAdmin(status?: string, voicehub?: string, q?: string, page?: number, perPage?: number): Promise<Paginated<Row>>;
  listRecent(limit?: number): Promise<Row[]>;
  stats(): Promise<Record<string, number>>;
  sumPaid(): Promise<number>;
  sumToday(timeZone?: string): Promise<number>;
  countToday(timeZone?: string): Promise<number>;
}

/** Payment confirmation/query seam (PHP PaymentService). */
export interface AdminPaymentServicePort {
  confirmPaid(order: Row, gateway: string, confirmationSource: string): Promise<void>;
  queryAndBackfill?(order: Row, tradeNo?: string | null): Promise<{ paid: boolean; status: number }>;
}

/** Order cancellation seam (PHP ShopService). */
export interface AdminShopServicePort {
  cancelUnpaidOrder(orderId: number, reason?: string): Promise<void>;
}

/** Fulfillment seam (PHP FulfillmentService). */
export interface AdminFulfillmentPort {
  processOrder(orderId: number): Promise<{ success?: number; failed?: number } | void>;
  retryUnit(unitId: number, force?: boolean): Promise<Row | null | void>;
  manualCompleteUnit(unitId: number, reason: string): Promise<void>;
  assignManualCode(unitId: number, code: string): Promise<void>;
  processPendingOrders?(limit?: number): Promise<{ processed?: number; success?: number; failed?: number }>;
}

/** Afdian order processor seam (PHP AfdianOrderProcessor). */
export interface AdminAfdianProcessorPort {
  processPoll(): Promise<Array<{ status?: string }>>;
  retry(outTradeNo: string, force?: boolean): Promise<{ status?: string; message?: string }>;
}

/** SG65 connectivity probe seam (PHP Sg65Client::merchantInfo). */
export interface AdminSg65ProbePort {
  merchantInfo(): Promise<unknown>;
}

/** SMTP test seam (PHP SmtpMailer). */
export interface AdminMailerPort {
  sendTest(to: string, subject: string, html: string): Promise<void>;
}

/** VoiceHub reachability probe seam (HEAD request only). */
export type AdminVoiceHubProbe = (baseUrl: string, token: string) => Promise<{ reachable: boolean; status: number; error: string }>;

/** Read-only database handle for KPI/system pages (SQLite or PostgreSQL). */
export interface AdminDatabasePort {
  readonly dialect: "sqlite" | "pgsql";
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number }>;
}

/** Everything `registerAdminRoutes` needs. */
export interface AdminDependencies {
  products: AdminProductPort;
  categories: AdminCategoryPort;
  inventory: AdminInventoryPort;
  orders: AdminOrderPort;
  payments: AdminPaymentPort;
  users: AdminUserPort;
  audit?: AdminAuditPort;
  voicehubDeliveries: AdminVoiceHubPort;
  afdianOrders: AdminAfdianPort;
  config: AdminConfigPort;
  sessions: SessionStore;
  crypto: AdminCryptoPort;
  clock?: Clock;
  /** Optional CSRF verifier/token issuer (defaults to auth-legacy Csrf). */
  csrf?: { verify(session: Record<string, unknown> | null | undefined, token: string | null | undefined): boolean; token(session: Record<string, unknown>): string };
  /** Secure cookie flag for the session cookie. */
  secureCookies?: boolean;
  social?: AdminSocialPort;
  units?: AdminUnitsPort;
  db?: AdminDatabasePort;
  paymentService?: AdminPaymentServicePort;
  shopService?: AdminShopServicePort;
  fulfillment?: AdminFulfillmentPort;
  afdianProcessor?: AdminAfdianProcessorPort;
  sg65Probe?: AdminSg65ProbePort;
  mailer?: AdminMailerPort;
  voicehubProbe?: AdminVoiceHubProbe;
}
