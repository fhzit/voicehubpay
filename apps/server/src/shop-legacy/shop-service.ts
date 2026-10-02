import { toCents, format } from "../../../../packages/db/src/legacy/money.js";
import { sign, verify } from "./sg65-signer.js";
import { Sg65Client } from "./sg65-client.js";
import type { Clock, CryptoPortFull, FulfillmentPort, MailerPort, OrdersPort, Row, TransactionsPort, UsersLookupPort } from "./types.js";

export { toCents as moneyToCents, format as moneyFormat };

export class ShopError extends Error {}
export class PaymentError extends Error {}

/** Port of VoiceHubPay\Shop\OrderNumberService. */
export class OrderNumberService {
  /**
   * Format: YYYYMMDDHHMMSSuuuuuu + 4 random digits = 24 numeric chars
   * (14-char second timestamp + 6-char microseconds + 4 random digits).
   * Uniqueness is guaranteed by the caller (ShopService.uniqueOrderNo retries).
   */
  static generate(clock: Clock = { now: () => Math.floor(Date.now() / 1000) }): string {
    const dt = new Date(clock.now() * 1000);
    const stamp =
      `${String(dt.getUTCFullYear()).padStart(4, "0")}` +
      `${String(dt.getUTCMonth() + 1).padStart(2, "0")}` +
      `${String(dt.getUTCDate()).padStart(2, "0")}` +
      `${String(dt.getUTCHours()).padStart(2, "0")}` +
      `${String(dt.getUTCMinutes()).padStart(2, "0")}` +
      `${String(dt.getUTCSeconds()).padStart(2, "0")}` +
      // 6-char microseconds, zero-padded (PHP format('u')).
      "000000";
    let rand = "";
    for (let i = 0; i < 4; i++) {
      rand += String(randomIntInclusive(0, 9));
    }
    return stamp + rand;
  }

  /** Unit number (and shop-order-no VoiceHub code) for a unit. */
  static unitNo(orderNo: string, index: number): string {
    return `${orderNo}-${String(index).padStart(3, "0")}`;
  }
}

function randomIntInclusive(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Port of VoiceHubPay\Shop\ShopService: validates a purchase, reserves
 * inventory, creates the order with order_items and fulfillment_units.
 * All amounts are integer cents computed server-side.
 */
export class ShopService {
  private readonly orders: OrdersPort;
  private readonly clock: Clock;
  private readonly crypto: CryptoPortFull;

  constructor(
    private readonly deps: {
      config: { int(key: string, fallback: number): number };
      orders: OrdersPort;
      products: { findById(id: number): Promise<Row | null> };
      inventory: {
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
      };
      transactions: { markCancelledForOrder(orderId: number): Promise<unknown> };
      crypto: CryptoPortFull;
      db: { transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> };
      clock?: Clock;
    },
  ) {
    this.orders = deps.orders;
    this.clock = deps.clock ?? { now: () => Math.floor(Date.now() / 1000) };
    this.crypto = deps.crypto;
  }

  /** Port of ShopService::validateQuantity(). */
  validateQuantity(product: Row, quantity: number): void {
    const min = Number(product["min_quantity"]);
    const max = Number(product["max_quantity"]);
    const step = Math.max(1, Number(product["quantity_step"]));
    if (quantity < min) throw new ShopError(`数量不能少于 ${min} 件。`);
    if (quantity > max) throw new ShopError(`数量不能超过 ${max} 件。`);
    if ((quantity - min) % step !== 0) throw new ShopError(`数量需按 ${step} 的步长选择。`);
  }

  /** Port of ShopService::maxPurchasable(). */
  async maxPurchasable(product: Row): Promise<number> {
    let max = Number(product["max_quantity"]);
    if (truthy(product["stock_enabled"])) {
      const available = await this.deps.inventory.countAvailable(Number(product["id"]));
      max = Math.min(max, available);
    }
    return max;
  }

  /**
   * Port of ShopService::createOrder(). Throws ShopError for validation
   * problems and Error('insufficient_stock') when stock is short (the caller's
   * transaction rolls back, mirroring the PHP rollback).
   */
  async createOrder(userId: number, productId: number, quantity: number): Promise<Row & { items: Row[]; units: Row[] }> {
    const product = await this.deps.products.findById(productId);
    if (product === null) throw new ShopError("商品不存在。");
    if (String(product["status"] ?? "") !== "active") throw new ShopError("该商品已下架。");
    this.validateQuantity(product, quantity);

    const priceCents = Number(product["price_cents"]);
    const amountDue = priceCents * quantity; // server-side computation

    const orderNo = await this.uniqueOrderNo();
    const ttlMinutes = Math.max(5, this.deps.config.int("ORDER_TTL_MINUTES", 30));
    const expiresAt = isoPlusMinutes(this.clock.now(), ttlMinutes);

    const deliveryMode = String(product["delivery_mode"] ?? "");
    const voicehubSource = String(product["voicehub_code_source"] ?? "");
    const needsStock = deliveryMode === "card" || deliveryMode === "card_and_voicehub";
    const voicehubEnabled = truthy(product["voicehub_enabled"]);

    return this.deps.db.transaction(async (tx: unknown) => {
      void tx;
      const order = await this.deps.orders.create({
        order_no: orderNo,
        user_id: userId,
        source: "shop",
        amount_due_cents: amountDue,
        amount_paid_cents: 0,
        currency: "CNY",
        order_status: "active",
        payment_status: "unpaid",
        fulfillment_status: "pending",
        expires_at: expiresAt,
      });
      const orderId = Number(order!["id"]);

      const itemId = await this.deps.orders.addItem({
        order_id: orderId,
        product_id: product["id"],
        product_name_snapshot: String(product["name"] ?? ""),
        product_price_cents_snapshot: priceCents,
        quantity,
        delivery_mode_snapshot: deliveryMode,
        voicehub_code_source_snapshot: voicehubSource,
      });

      // Atomic reservation of N available cards when stock is used.
      // reserve() throws when insufficient — transaction rolls back.
      let cards: Row[] = [];
      if (needsStock) {
        cards = await this.deps.inventory.reserve(Number(product["id"]), quantity, orderId, expiresAt, true, this.crypto);
      }

      for (let i = 1; i <= quantity; i++) {
        const unitNo = OrderNumberService.unitNo(orderNo, i);
        const card = cards[i - 1] ?? null;

        let deliveryCipher: string | null = null;
        let deliveryHash: string | null = null;
        let voicehubCipher: string | null = null;
        let voicehubHash: string | null = null;
        let voicehubStatus = "not_required";
        const unitStatus = "pending";

        if (deliveryMode === "card" || deliveryMode === "card_and_voicehub") {
          // Stock card is the deliverable.
          deliveryCipher = card === null ? null : String(card["secret_ciphertext"]);
          deliveryHash = card === null ? null : String(card["secret_hash"]);
          if (voicehubEnabled) {
            // code_source=inventory: the card secret IS the VoiceHub code.
            voicehubCipher = deliveryCipher;
            voicehubHash = deliveryHash;
            voicehubStatus = "pending";
          }
        } else if (deliveryMode === "voicehub") {
          // No stock; deliverable = the shop order voucher code.
          deliveryCipher = this.crypto.encrypt(unitNo);
          deliveryHash = this.crypto.hash(unitNo);
          if (voicehubEnabled) {
            voicehubCipher = deliveryCipher;
            voicehubHash = deliveryHash;
            voicehubStatus = "pending";
          }
        } // manual: codes assigned later by admin.

        await this.deps.orders.addUnit({
          order_id: orderId,
          order_item_id: itemId,
          unit_index: i,
          unit_no: unitNo,
          inventory_card_id: card === null ? null : Number(card["id"]),
          delivery_code_ciphertext: deliveryCipher,
          delivery_code_hash: deliveryHash,
          voicehub_code_ciphertext: voicehubCipher,
          voicehub_code_hash: voicehubHash,
          status: unitStatus,
          voicehub_status: voicehubStatus,
        });
      }

      return (await this.orders.orderWithItems(orderNo))!;
    });
  }

  /** Port of ShopService::cancelUnpaidOrder(). */
  async cancelUnpaidOrder(orderId: number, reason = "user_cancel"): Promise<void> {
    void reason;
    const order = await this.orders.findById(orderId);
    if (order === null) throw new ShopError("订单不存在。");
    if (["paid", "pending"].includes(String(order["payment_status"] ?? ""))) {
      throw new ShopError("已支付订单不能取消。");
    }
    await this.deps.db.transaction(async () => {
      await this.deps.inventory.releaseForOrder(orderId);
      await this.orders.update(orderId, {
        order_status: "cancelled",
        cancelled_at: gmdateC(),
      });
      // Mark this order's (unpaid/pending) payment transactions as cancelled
      // so the payment ledger does not keep showing them as 待确认.
      await this.deps.transactions.markCancelledForOrder(orderId);
    });
  }

  private async uniqueOrderNo(): Promise<string> {
    for (;;) {
      const orderNo = OrderNumberService.generate(this.clock);
      if ((await this.orders.findByOrderNo(orderNo)) === null) return orderNo;
    }
  }
}

/** Port of VoiceHubPay\Payments\PaymentService (create/notify/query/reconcile). */
export class PaymentService {
  private readonly sg65: Sg65Client;
  private readonly orders: OrdersPort;
  private readonly transactions: TransactionsPort;
  private readonly clock: Clock;
  private readonly config: { get(key: string, fallback?: string): string; appUrl(): string };
  private readonly crypto: CryptoPortFull;
  private readonly fulfillment?: FulfillmentPort;
  private readonly mailer?: MailerPort;
  private readonly users?: UsersLookupPort;

  constructor(deps: {
    config: { get(key: string, fallback?: string): string; appUrl(): string };
    clock?: Clock;
    sg65: Sg65Client;
    orders: OrdersPort;
    transactions: TransactionsPort;
    crypto: CryptoPortFull;
    fulfillment?: FulfillmentPort;
    mailer?: MailerPort;
    users?: UsersLookupPort;
  }) {
    this.sg65 = deps.sg65;
    this.orders = deps.orders;
    this.transactions = deps.transactions;
    this.clock = deps.clock ?? { now: () => Math.floor(Date.now() / 1000) };
    this.config = deps.config;
    this.crypto = deps.crypto;
    this.fulfillment = deps.fulfillment;
    this.mailer = deps.mailer;
    this.users = deps.users;
  }

  /** Port of PaymentService::createPayment(). Returns { pay_info, trade_no }. */
  async createPayment(order: Row, payType: string, clientIp: string): Promise<{ pay_info: string; trade_no: string }> {
    if (!this.sg65.isEnabled()) throw new PaymentError("支付功能暂未开启。");
    if (!["alipay", "wxpay", "qqpay"].includes(payType)) throw new PaymentError("不支持的支付方式。");
    if (!this.sg65.isPayTypeEnabled(payType)) throw new PaymentError("该支付方式未开启。");
    if (String(order["payment_status"] ?? "") === "paid") {
      throw new PaymentError("订单已支付，请勿重复支付。");
    }
    // payment_status === 'pending': re-entry is allowed — reuse the flow.

    const appUrl = this.config.appUrl();
    const items = await this.orders.items(Number(order["id"]));
    const firstName = items.length > 0 ? String(items[0]?.["product_name_snapshot"] ?? "") : "";
    let name = firstName !== "" ? firstName : "数字商品";
    const firstQuantity = items.length > 0 ? Number(items[0]?.["quantity"] ?? 1) : 1;
    if (Number(order["amount_due_cents"]) > 0 && (items.length > 1 || firstQuantity > 1)) {
      name += " 等";
    }

    const method = this.config.get("SG65_DEFAULT_METHOD", "jump");
    const params: Record<string, string> = {
      pid: this.sg65.pid(),
      method,
      type: payType,
      out_trade_no: String(order["order_no"]),
      notify_url: `${appUrl}/payments/sg65/notify`,
      return_url: `${appUrl}/payments/sg65/return`,
      name: truncateUtf8(name, 64),
      money: format(Number(order["amount_due_cents"])),
      clientip: clientIp,
      timestamp: String(this.clock.now()),
    };

    const response = await this.sg65.create(params);
    assertResponse(response);

    const payInfo = String(firstOf(response, "pay_info") ?? "");
    const tradeNo = String(firstOf(response, "trade_no") ?? "");
    if (payInfo === "") throw new PaymentError("支付创建失败：未返回跳转地址。");

    await this.transactions.upsert({
      order_id: Number(order["id"]),
      gateway: "sg65",
      merchant_order_no: String(order["order_no"]),
      gateway_trade_no: tradeNo !== "" ? tradeNo : null,
      amount_cents: Number(order["amount_due_cents"]),
      status: "pending",
      pay_type: payType,
      pay_url: payInfo,
      confirmation_source: "callback",
    });

    return { pay_info: payInfo, trade_no: tradeNo };
  }

  /** Port of PaymentService::handleNotify(). Returns plain-text body ("success"). */
  async handleNotify(query: Record<string, unknown>): Promise<string> {
    if (!this.sg65.isEnabled()) return "disabled";
    if (!verify(query, this.sg65.platformPublicKey())) return "verify_failed";
    if (String(query["pid"] ?? "") !== this.sg65.pid()) return "pid_mismatch";
    if (String(query["trade_status"] ?? "") !== "TRADE_SUCCESS") return "not_success";
    const orderNo = String(query["out_trade_no"] ?? "");
    const order = orderNo !== "" ? await this.orders.findByOrderNo(orderNo) : null;
    if (order === null) return "order_not_found";

    let paidCents: number;
    try {
      paidCents = toCents(String(query["money"] ?? ""));
    } catch {
      return "bad_money";
    }
    if (paidCents !== Number(order["amount_due_cents"])) return "amount_mismatch";

    const tradeNo = String(query["trade_no"] ?? "");
    const apiTradeNo = String(query["api_trade_no"] ?? "");
    const payType = String(query["type"] ?? "");

    const tx = await this.transactions.upsert({
      order_id: Number(order["id"]),
      gateway: "sg65",
      merchant_order_no: orderNo,
      gateway_trade_no: tradeNo !== "" ? tradeNo : null,
      api_trade_no: apiTradeNo !== "" ? apiTradeNo : null,
      amount_cents: paidCents,
      status: "paid",
      pay_type: ["alipay", "wxpay", "qqpay"].includes(payType) ? payType : null,
      confirmation_source: "callback",
      raw_notify_payload: jsonEncodeUnicode(query),
    });
    if (tx !== null) {
      await this.transactions.markPaid(Number(tx["id"]), tradeNo, apiTradeNo, "callback");
    }

    // Idempotent payment confirmation.
    await this.confirmPaid(order, "sg65", "callback");
    return "success";
  }

  /**
   * Port of PaymentService::confirmPaid(). Idempotent; never blocks on
   * VoiceHub — fulfillment/mailer failures are logged and swallowed.
   */
  async confirmPaid(order: Row, gateway: string, confirmationSource: string): Promise<void> {
    if (String(order["payment_status"] ?? "") === "paid") return;
    await this.orders.markPaid(Number(order["id"]), Number(order["amount_due_cents"]), gateway, confirmationSource);
    // Notifications are best-effort and must never break the payment path.
    try {
      await this.notifyOrderPaid(order);
    } catch (error) {
      logError("[mail paid]", error);
    }
    try {
      await this.fulfillment?.preparePaidOrder(Number(order["id"]));
    } catch (error) {
      logError("[fulfillment prepare]", error);
    }
    // Best-effort quick trigger (must not block the notify response).
    try {
      await this.fulfillment?.processOrder(Number(order["id"]));
    } catch (error) {
      logError("[fulfillment quick]", error);
    }
  }

  private async notifyOrderPaid(order: Row): Promise<void> {
    if (this.mailer === undefined) return;
    const orderNo = String(order["order_no"] ?? "");
    const amountYuan = format(Number(order["amount_due_cents"] ?? 0));
    const itemName = await this.firstItemName(Number(order["id"]));

    // Admin alert for every paid order.
    let buyer = "";
    const userId = Number(order["user_id"] ?? 0);
    if (userId > 0 && this.users !== undefined) {
      const user = await this.users.findById(userId);
      if (user !== null) {
        buyer = String(user["display_name"] || user["username"] || "");
        const to = String(user["email"] ?? "");
        if (to !== "") await this.mailer.orderPaid(orderNo, itemName, amountYuan, to);
      }
    }
    await this.mailer.adminOrderReceived(orderNo, amountYuan, buyer !== "" ? buyer : "游客");
  }

  private async firstItemName(orderId: number): Promise<string> {
    try {
      const items = await this.orders.items(orderId);
      return items.length > 0 ? String(items[0]?.["product_name_snapshot"] ?? "") : "";
    } catch {
      return "";
    }
  }

  /** Port of PaymentService::queryAndBackfill(). Active query + safe backfill (source = query). */
  async queryAndBackfill(order: Row, tradeNo: string | null = null): Promise<{ paid: boolean; status: number }> {
    const params: Record<string, string> = {};
    if (tradeNo !== null && tradeNo !== "") {
      params["trade_no"] = tradeNo;
    } else {
      params["out_trade_no"] = String(order["order_no"]);
    }
    const response = await this.sg65.query(params);

    // SG65 status: 0 unpaid, 1 paid, 2 refunded, 3 frozen, 4 pre-auth.
    const status = Number(firstOf(response, "status") ?? -1);
    if (status === 1 && this.verifyBackfill(response, order)) {
      await this.confirmPaid(order, "sg65", "query");
      return { paid: true, status };
    }
    return { paid: false, status };
  }

  private verifyBackfill(response: Record<string, unknown>, order: Row): boolean {
    if (!verify(response, this.sg65.platformPublicKey())) return false;
    const pid = String(response["pid"] ?? "");
    if (pid !== "" && pid !== this.sg65.pid()) return false;
    const orderNo = String(firstOf(response, "out_trade_no") ?? "");
    if (orderNo === "" || orderNo !== String(order["order_no"])) return false;
    const money = String(firstOf(response, "money") ?? "");
    if (money === "") return false;
    try {
      if (toCents(money) !== Number(order["amount_due_cents"])) return false;
    } catch {
      return false;
    }
    return true;
  }

  /** Port of PaymentService::reconcile(). Fetch recent merchant orders and backfill. limit capped at 50. */
  async reconcile(limit = 50, offset = 0): Promise<{ backfilled: number; checked: number }> {
    const capped = Math.max(1, Math.min(limit, 50));
    const response = await this.sg65.merchantOrders({ offset: String(offset), limit: String(capped) });
    assertResponse(response);

    let backfilled = 0;
    let orders: unknown = firstOf(response, "orders") ?? firstOf(response, "list") ?? response["data"];
    if (Array.isArray(orders)) {
      for (const merchantOrder of orders) {
        const row = (typeof merchantOrder === "object" && merchantOrder !== null ? merchantOrder : {}) as Row;
        const outTradeNo = String(row["out_trade_no"] ?? "");
        const status = Number(row["status"] ?? -1);
        if (outTradeNo === "" || status !== 1) continue;
        const order = await this.orders.findByOrderNo(outTradeNo);
        if (order === null || String(order["payment_status"] ?? "") === "paid") continue;
        // The merchant list is discovery-only. Confirm every candidate
        // through the signed single-order query before changing local state.
        const tradeNo = String(row["trade_no"] ?? "");
        const result = await this.queryAndBackfill(order, tradeNo !== "" ? tradeNo : null);
        if (result.paid) backfilled += 1;
      }
    }
    return { backfilled, checked: Array.isArray(orders) ? orders.length : 0 };
  }
}

function assertResponse(response: Record<string, unknown>): void {
  const code = Number(response["code"] ?? -1);
  if (code !== 0) {
    const msg = String(response["msg"] ?? response["message"] ?? "unknown error");
    throw new PaymentError(`SG65 返回错误：${msg}`);
  }
}

/** First hit across value / data.* shapes (PHP ($x['a'] ?? $x['data']['a'])). */
function firstOf(response: Record<string, unknown>, key: string): unknown {
  if (response[key] !== undefined && response[key] !== null) return response[key];
  const data = response["data"];
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const direct = (data as Row)[key];
    if (direct !== undefined && direct !== null) return direct;
    const nested = (data as Row)["order"];
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      const value = (nested as Row)[key];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

/** mb_substr($name, 0, 64) — code-point truncation. */
export function truncateUtf8(value: string, maxCodePoints: number): string {
  return [...value].slice(0, maxCodePoints).join("");
}

/** gmdate('c') — ISO-8601 UTC with +00:00. */
export function gmdateC(nowSeconds = Math.floor(Date.now() / 1000)): string {
  return new Date(nowSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function isoPlusMinutes(nowSeconds: number, minutes: number): string {
  return new Date((nowSeconds + minutes * 60) * 1000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/** json_encode(..., JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) equivalent. */
export function jsonEncodeUnicode(value: unknown): string {
  return JSON.stringify(value).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function logError(prefix: string, error: unknown): void {
  console.error(prefix, error instanceof Error ? error.message : String(error));
}

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "" && value !== "0";
  return false;
}
