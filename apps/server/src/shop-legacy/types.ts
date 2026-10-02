/**
 * Shared types for the legacy (PHP-parity) shop/payment module.
 *
 * The ports mirror VoiceHubPay\* PHP classes 1:1 — row shapes stay snake_case
 * like the legacy schema, and error strings stay byte-identical to PHP.
 */

/** Legacy-schema row (database/migrations/*.sql). */
export type Row = Record<string, unknown>;

/** Seconds since the Unix epoch — injectable for deterministic tests. */
export interface Clock {
  now(): number;
}

export function systemClock(): Clock {
  return { now: () => Math.floor(Date.now() / 1000) };
}

/** Config surface used by the ported services (App->config). */
export interface ConfigPort {
  get(key: string, fallback?: string): string;
  bool(key: string, fallback: boolean): boolean;
  int(key: string, fallback: number): number;
  /** PHP Config::appUrl() — rtrim of SITE_URL/APP_URL. */
  appUrl(): string;
}

/** Port of ProductRepository surface used by ShopService. */
export interface ProductsPort {
  findById(id: number): Promise<Row | null>;
}

/** Port of OrderRepository surface used by ShopService/PaymentService/routes. */
export interface OrdersPort {
  findById(id: number): Promise<Row | null>;
  findByOrderNo(orderNo: string): Promise<Row | null>;
  create(data: Row): Promise<Row | null>;
  update(id: number, fields: Row): Promise<void>;
  markPaid(id: number, amountPaidCents: number, gateway: string, confirmationSource: string): Promise<void>;
  items(orderId: number): Promise<Row[]>;
  addItem(data: Row): Promise<number>;
  addUnit(data: Row): Promise<number>;
  units(orderId: number): Promise<Row[]>;
  findUnit(unitId: number): Promise<Row | null>;
  countUnitsByStatus(orderId: number): Promise<Record<string, number>>;
  orderWithItems(orderNo: string): Promise<(Row & { items: Row[]; units: Row[] }) | null>;
  findExpiredUnpaid(nowIsoValue: string, limit?: number): Promise<Row[]>;
}

/** Port of InventoryRepository surface used by ShopService. */
export interface InventoryPort {
  countAvailable(productId: number): Promise<number>;
  reserve(
    productId: number,
    quantity: number,
    orderId: number,
    reservedUntil: string,
    withSecrets?: boolean,
    crypto?: CryptoPortFull,
  ): Promise<Row[]>;

  releaseForOrder(orderId: number): Promise<number>;
}

/** Port of CryptoService surface used by shop/payment. */
export interface CryptoPortFull {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
  hash(value: string): string;
  mask(value: string): string;
}

/** Port of PaymentTransactionRepository surface used by PaymentService. */
export interface TransactionsPort {
  upsert(data: Row): Promise<Row | null>;
  markPaid(id: number, gatewayTradeNo: string, apiTradeNo: string, confirmationSource: string): Promise<void>;
  markCancelledForOrder(orderId: number): Promise<number>;
  listForOrder(orderId: number): Promise<Row[]>;
}

/** Fulfillment seam (PHP App->make('fulfillment')). Payment and fulfillment are DECOUPLED: never blocks the notify path. */
export interface FulfillmentPort {
  preparePaidOrder(orderId: number): Promise<void>;
  processOrder(orderId: number): Promise<void>;
}

/** Best-effort mailer seam (PHP App->make('mailer')). */
export interface MailerPort {
  orderPaid(orderNo: string, itemName: string, amountYuan: string, to: string): Promise<void>;
  adminOrderReceived(orderNo: string, amountYuan: string, buyer: string): Promise<void>;
}

/** PHP App->make('users') surface used for the paid-order buyer mail. */
export interface UsersLookupPort {
  findById(id: number): Promise<Row | null>;
}

/** Audit seam (PHP Controller::audit). */
export interface AuditPort {
  log(
    userId: number | null,
    action: string,
    objectType?: string,
    objectId?: string,
    metadata?: Record<string, unknown>,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<void>;
}

/** Injectable SG65 HTTP transport — external HTTP stays behind this seam. */
export interface Sg65HttpPost {
  (path: string, body: string): Promise<{ status: number; text: string }>;
}

/** PHP-style session store (auth-legacy SessionStore shape) for the routes. */
export interface RouteSessionStore {
  load(id: string): Promise<Record<string, unknown> | null>;
  create(id: string, data: Record<string, unknown>): Promise<void>;
  save(id: string, data: Record<string, unknown>): Promise<void>;
  destroy(id: string): Promise<void>;
}

/** Everything the shop/payment route configurators need. */
export interface ShopLegacyDependencies {
  /** Required for the route configurators (session/CSRF helpers). */
  sessions: RouteSessionStore;
  db: {
    transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T>;
  };
  config: ConfigPort;
  clock?: Clock;
  crypto: CryptoPortFull;
  products: ProductsPort;
  orders: OrdersPort;
  inventory: InventoryPort;
  transactions: TransactionsPort;
  fulfillment?: FulfillmentPort;
  mailer?: MailerPort;
  users?: UsersLookupPort;
  audit?: AuditPort;
  /** SG65 HTTP transport (defaults to Node fetch against https://bbs.sg65.cn). */
  sg65Post?: Sg65HttpPost;
}
