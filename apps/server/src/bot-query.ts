import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

/**
 * Bot-facing coupon lookup API.
 *
 * A single POST endpoint resolves a VoiceHubPay order number, an Afdian
 * out_trade_no, or a song-request coupon code to the order + its coupons.
 * It is the only surface that returns plaintext codes, so it is guarded by a
 * shared token (`BOT_QUERY_TOKEN`). The AstrBot plugin is the sole consumer.
 *
 * Query order (contract §2):
 *   1. shop orders.order_no exact
 *   2. afdian_orders.out_trade_no exact
 *   3. coupon SHA-256 reverse lookup in fulfillment_units / voicehub_deliveries
 *   4. "<orderNo>-NNN" unit numbers fall back to the prefix order number
 */

type Row = Record<string, unknown>;

/** Structural port of `OrderRepository` (shop orders). */
export interface BotOrderRepository {
  findByOrderNo(orderNo: string): Promise<Row | null>;
  findById(id: number): Promise<Row | null>;
  items(orderId: number): Promise<Row[]>;
  units(orderId: number): Promise<Row[]>;
  findUnitByCodeHash(hash: string): Promise<Row | null>;
}

/** Structural port of `AfdianOrderRepository`. */
export interface BotAfdianOrderRepository {
  findByOutTradeNo(outTradeNo: string): Promise<Row | null>;
}

/** Structural port of `VoiceHubDeliveryRepository`. */
export interface BotDeliveryRepository {
  findByCodeHash(hash: string): Promise<Row | null>;
  listBySourceOrderNo(sourceType: string, sourceOrderNo: string): Promise<Row[]>;
}

/** Structural port of `CryptoService` (hash / mask / decrypt only). */
export interface BotCrypto {
  hash(value: string): string;
  mask(value: string): string;
  decrypt(cipher: string): string;
}

export interface BotQueryDependencies {
  orders: BotOrderRepository;
  afdianOrders: BotAfdianOrderRepository;
  deliveries: BotDeliveryRepository;
  crypto: BotCrypto;
  /** Shared secret from BOT_QUERY_TOKEN; empty disables the endpoint (503). */
  token: string;
}

export interface CouponView {
  code: string;
  masked_code: string;
  unit_no: string;
  kind: "voicehub" | "card";
  unit_status: string;
  voicehub_status: string;
  voicehub_error: string | null;
  delivered_at: string | null;
}

export interface OrderView {
  order_no: string;
  source: "shop" | "afdian";
  amount_cents: number;
  amount_paid_cents: number;
  currency: string;
  payment_status: string;
  order_status: string;
  fulfillment_status: string;
  created_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  expires_at: string | null;
  items: Array<{ name: string; quantity: number; unit_price_cents: number; delivery_mode: string }>;
  afdian: { trade_no: string; plan_id: string; sku_detail: string } | null;
}

export interface BotQueryResult {
  ok: true;
  found_by: "shop_order" | "afdian_order" | "coupon_code";
  source: "shop" | "afdian";
  order: OrderView;
  coupons: CouponView[];
}

const QUERY_INVALID_PATTERN = /[\s\u0000-\u001F\u007F]/;
const UNIT_NO_PATTERN = /^(.+)-(\d{1,6})$/;
const MIN_QUERY_LENGTH = 6;
const MAX_QUERY_LENGTH = 128;

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

/** Trim + length + printable validation of the body's `query`. */
export function normalizeQuery(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const raw = (body as Record<string, unknown>)["query"];
  if (typeof raw !== "string") return null;
  const query = raw.trim();
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) return null;
  // Inventory cards may carry custom prefixes/suffixes (Chinese, punctuation);
  // only whitespace and control characters are invalid, never the charset.
  if (QUERY_INVALID_PATTERN.test(query)) return null;
  return query;
}

/** Constant-time token comparison (length-independent via fixed-size digests). */
export function tokenMatches(expected: string, provided: string): boolean {
  const a = createHash("sha256").update(expected, "utf8").digest();
  const b = createHash("sha256").update(provided, "utf8").digest();
  return timingSafeEqual(a, b);
}

function providedToken(headers: Record<string, unknown>): string {
  const direct = headers["x-bot-token"];
  if (typeof direct === "string" && direct !== "") return direct;
  const authorization = headers["authorization"];
  if (typeof authorization === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match !== null && match[1] !== undefined) return match[1].trim();
  }
  return "";
}

function decode(deps: BotQueryDependencies, cipher: unknown): string | null {
  if (cipher === null || cipher === undefined || cipher === "") return null;
  try {
    return deps.crypto.decrypt(String(cipher));
  } catch {
    // A corrupt ciphertext must not leak a 500 with internal detail.
    return null;
  }
}

/** One coupon per fulfillment unit; units without a code are omitted. */
function shopCoupons(deps: BotQueryDependencies, units: Row[]): CouponView[] {
  const coupons: CouponView[] = [];
  for (const unit of units) {
    const voicehubStatus = String(unit["voicehub_status"] ?? "");
    const kind: CouponView["kind"] = voicehubStatus === "not_required" ? "card" : "voicehub";
    const cipher = kind === "card" ? unit["delivery_code_ciphertext"] : unit["voicehub_code_ciphertext"];
    const code = decode(deps, cipher);
    if (code === null) continue;
    coupons.push({
      code,
      masked_code: deps.crypto.mask(code),
      unit_no: String(unit["unit_no"] ?? ""),
      kind,
      unit_status: String(unit["status"] ?? ""),
      voicehub_status: voicehubStatus,
      voicehub_error: nullableText(unit["voicehub_last_error"]),
      delivered_at: nullableText(unit["fulfilled_at"]),
    });
  }
  return coupons;
}

async function shopResult(
  deps: BotQueryDependencies,
  order: Row,
  foundBy: BotQueryResult["found_by"],
): Promise<BotQueryResult> {
  const orderId = num(order["id"]);
  const [items, units] = await Promise.all([deps.orders.items(orderId), deps.orders.units(orderId)]);
  return {
    ok: true,
    found_by: foundBy,
    source: "shop",
    order: {
      order_no: String(order["order_no"] ?? ""),
      source: "shop",
      amount_cents: num(order["amount_due_cents"]),
      amount_paid_cents: num(order["amount_paid_cents"]),
      currency: String(order["currency"] ?? "CNY"),
      payment_status: String(order["payment_status"] ?? ""),
      order_status: String(order["order_status"] ?? ""),
      fulfillment_status: String(order["fulfillment_status"] ?? ""),
      created_at: nullableText(order["created_at"]),
      paid_at: nullableText(order["paid_at"]),
      fulfilled_at: nullableText(order["fulfilled_at"]),
      expires_at: nullableText(order["expires_at"]),
      items: items.map((item) => ({
        name: String(item["product_name_snapshot"] ?? ""),
        quantity: num(item["quantity"]),
        unit_price_cents: num(item["product_price_cents_snapshot"]),
        delivery_mode: String(item["delivery_mode_snapshot"] ?? ""),
      })),
      afdian: null,
    },
    coupons: shopCoupons(deps, units),
  };
}

async function afdianResult(
  deps: BotQueryDependencies,
  order: Row,
  foundBy: BotQueryResult["found_by"],
): Promise<BotQueryResult> {
  const orderNo = String(order["out_trade_no"] ?? "");
  const amountCents = num(order["amount_cents"]);
  const paid = ["paid", "2"].includes(String(order["status"] ?? ""));
  const skuDetail = String(order["sku_detail"] ?? "");
  const deliveries = await deps.deliveries.listBySourceOrderNo("afdian", orderNo);
  const coupons: CouponView[] = [];
  for (const delivery of deliveries) {
    const code = decode(deps, delivery["code_ciphertext"]);
    if (code === null) continue;
    coupons.push({
      code,
      masked_code: deps.crypto.mask(code),
      unit_no: "",
      kind: "voicehub",
      unit_status: String(delivery["status"] ?? ""),
      voicehub_status: String(delivery["status"] ?? ""),
      voicehub_error: nullableText(delivery["last_error"]),
      delivered_at: nullableText(delivery["success_at"]),
    });
  }
  return {
    ok: true,
    found_by: foundBy,
    source: "afdian",
    order: {
      order_no: orderNo,
      source: "afdian",
      amount_cents: amountCents,
      amount_paid_cents: paid ? amountCents : 0,
      currency: "CNY",
      payment_status: paid ? "paid" : String(order["status"] ?? ""),
      order_status: "active",
      fulfillment_status: String(order["voicehub_status"] ?? ""),
      created_at: nullableText(order["created_at"]),
      paid_at: nullableText(order["paid_at"]),
      fulfilled_at: null,
      expires_at: null,
      items: [
        {
          name: skuDetail !== "" ? skuDetail : "爱发电订单",
          quantity: 1,
          unit_price_cents: amountCents,
          delivery_mode: "voicehub",
        },
      ],
      afdian: {
        trade_no: String(order["trade_no"] ?? ""),
        plan_id: String(order["plan_id"] ?? ""),
        sku_detail: skuDetail,
      },
    },
    coupons,
  };
}

/** Resolve a stored delivery row to its owning order (shop or Afdian). */
async function deliveryResult(
  deps: BotQueryDependencies,
  delivery: Row,
): Promise<BotQueryResult | null> {
  const sourceType = String(delivery["source_type"] ?? "");
  const sourceOrderNo = String(delivery["source_order_no"] ?? "");
  if (sourceOrderNo === "") return null;
  const isAfdian = sourceType === "afdian" || String(delivery["code_source"] ?? "") === "afdian_order_no";
  if (isAfdian) {
    const order = await deps.afdianOrders.findByOutTradeNo(sourceOrderNo);
    return order === null ? null : afdianResult(deps, order, "coupon_code");
  }
  const order = await deps.orders.findByOrderNo(sourceOrderNo);
  return order === null ? null : shopResult(deps, order, "coupon_code");
}

async function findOrder(deps: BotQueryDependencies, query: string): Promise<BotQueryResult | null> {
  // 1. shop order number
  const shopOrder = await deps.orders.findByOrderNo(query);
  if (shopOrder !== null) return shopResult(deps, shopOrder, "shop_order");

  // 2. Afdian out_trade_no
  const afdianOrder = await deps.afdianOrders.findByOutTradeNo(query);
  if (afdianOrder !== null) return afdianResult(deps, afdianOrder, "afdian_order");

  // 3. coupon code: SHA-256 reverse lookup (units first, then deliveries).
  // 券码由库存生成器产生，大小写可能与用户输入不同；按原文、全大写、全小写
  // 依次尝试，避免只因大小写差异就落到「无订单」分支。
  const variants = new Set([query, query.toUpperCase(), query.toLowerCase()]);
  for (const candidate of variants) {
    const hash = deps.crypto.hash(candidate);
    const unit = await deps.orders.findUnitByCodeHash(hash);
    if (unit !== null) {
      const order = await deps.orders.findById(num(unit["order_id"]));
      if (order !== null) return shopResult(deps, order, "coupon_code");
    }
    const delivery = await deps.deliveries.findByCodeHash(hash);
    if (delivery !== null) {
      const result = await deliveryResult(deps, delivery);
      if (result !== null) return result;
    }
  }

  // 4. unit number "<orderNo>-NNN" -> prefix order number
  const prefixed = UNIT_NO_PATTERN.exec(query);
  if (prefixed !== null && prefixed[1] !== undefined) {
    const prefix = prefixed[1];
    const prefixedShop = await deps.orders.findByOrderNo(prefix);
    if (prefixedShop !== null) return shopResult(deps, prefixedShop, "coupon_code");
    const prefixedAfdian = await deps.afdianOrders.findByOutTradeNo(prefix);
    if (prefixedAfdian !== null) return afdianResult(deps, prefixedAfdian, "coupon_code");
  }

  return null;
}

export function configureBotQuery(app: FastifyInstance, deps: BotQueryDependencies): void {
  app.post("/api/bot/coupon-query", async (request, reply) => {
    if (deps.token === "") {
      return reply.code(503).send({ ok: false, error: "BOT_QUERY_DISABLED" });
    }
    const provided = providedToken(request.headers as Record<string, unknown>);
    if (provided === "" || !tokenMatches(deps.token, provided)) {
      return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
    }

    const query = normalizeQuery(request.body);
    if (query === null) {
      return reply.code(400).send({ ok: false, error: "INVALID_QUERY" });
    }

    const result = await findOrder(deps, query);
    if (result === null) {
      return reply.code(404).send({ ok: false, error: "NOT_FOUND" });
    }
    return reply.code(200).send(result);
  });
}
