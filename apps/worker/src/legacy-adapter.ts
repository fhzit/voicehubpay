import { createHash } from "node:crypto";
import { Pool } from "pg";
import { createPostgresDatabase, createSqliteDatabase, InventoryRepository, OrderRepository, VoiceHubDeliveryRepository, AfdianOrderRepository, CryptoService, toCents, type Database } from "../../../packages/db/src/index.js";
import { ShopService } from "../../server/src/shop-legacy/shop-service.js";
import { createShopLegacyDependencies, EnvShopConfig } from "../../server/src/shop-legacy/index.js";
import type { WorkerPorts } from "./index.js";

export async function createLegacyWorkerPorts(env: NodeJS.ProcessEnv = process.env): Promise<WorkerPorts> {
  let db: Database; let close: () => Promise<void>;
  if (env.DATABASE_URL) { const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 }); db = createPostgresDatabase(pool); close = () => pool.end(); }
  else if (env.DATABASE_PATH) { const sqlite = createSqliteDatabase(env.DATABASE_PATH); db = sqlite; close = () => sqlite.close(); }
  else throw new Error("DATABASE_URL or DATABASE_PATH is required for worker adapters");
  const basePath = env.APP_BASE_PATH ?? process.cwd();
  const config = new EnvShopConfig(env); const crypto = new CryptoService(basePath);
  const deps = createShopLegacyDependencies(db, config, { basePath });
  const inventory = new InventoryRepository(db); const orders = new OrderRepository(db); const deliveries = new VoiceHubDeliveryRepository(db); const shop = new ShopService(deps);
  const afdianOrders = new AfdianOrderRepository(db);
  const processOrder = async (orderId: number): Promise<number> => {
    const order = await orders.findById(orderId); if (!order || order.payment_status !== "paid") return 0;
    let count = 0;
    for (const unit of await orders.units(orderId)) {
      if (!["pending", "processing", "failed"].includes(String(unit.voicehub_status)) || !unit.voicehub_code_ciphertext) continue;
      let delivery = await deliveries.findByUnitId(Number(unit.id));
      if (!delivery) {
        const code = crypto.decrypt(String(unit.voicehub_code_ciphertext)); const hash = String(unit.voicehub_code_hash || crypto.hash(code)); const item = (await orders.items(orderId))[0];
        const fromInventory = item && ["card", "card_and_voicehub"].includes(String(item.delivery_mode_snapshot)) && item.voicehub_code_source_snapshot === "inventory";
        const key = fromInventory ? `shop:${order.order_no}:${unit.unit_no}:${hash}` : `shop:${order.order_no}:${unit.unit_no}`;
        ({ delivery } = await deliveries.createIfAbsent({ source_type: "shop", source_id: orderId, source_order_no: String(order.order_no), fulfillment_unit_id: Number(unit.id), code_ciphertext: String(unit.voicehub_code_ciphertext), code_hash: hash, code_source: fromInventory ? "inventory" : "shop_order_no", idempotency_key: key, status: "pending" }));
      }
      if (!delivery || delivery.status === "success") continue;
      const code = crypto.decrypt(String(delivery.code_ciphertext)); const endpoint = `${config.get("VOICEHUB_API_BASE").replace(/\/+$/, "")}${config.get("VOICEHUB_TICKET_ENDPOINT", "/api/open/card-codes")}`;
      const payload = JSON.stringify({ codes: [code], note: `voicehubpay | source=${delivery.source_type} | order=${delivery.source_order_no} | unit=${unit.unit_no ?? ""} | amount=${order.amount_due_cents ?? ""}` });
      if (!await deliveries.claimForProcessing(Number(delivery.id), payload, Math.max(1, config.int("VOICEHUB_RETRIES", 3)))) continue;
      delivery = await deliveries.findById(Number(delivery.id)) ?? delivery;
      await orders.updateUnit(Number(unit.id), { status: "processing", voicehub_status: "processing", voicehub_attempts: Number(delivery.attempts) });
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "x-api-key": secret("VOICEHUB_API_TOKEN"), Accept: "application/json", "Content-Type": "application/json" }, body: payload, signal: AbortSignal.timeout(Math.max(5, config.int("VOICEHUB_TIMEOUT", 20)) * 1000), redirect: "manual" });
        const body = await response.text(); let parsed: Record<string, unknown>; try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { parsed = { raw: body }; }
        const message = String(parsed.message ?? parsed.error ?? ""); const exists = /点歌券已经存在|无需重复创建|已存在|already exists|already created/i.test(message);
        if (response.status >= 400 && !exists) throw new Error(`VoiceHub rejected request (HTTP ${response.status})`);
        if (parsed.success !== undefined && parsed.success !== true && Number(parsed.code ?? 0) !== 0 && !exists) throw new Error("VoiceHub rejected request");
        await deliveries.markSuccess(Number(delivery.id), JSON.stringify(parsed));
        await orders.updateUnit(Number(unit.id), { status: "success", voicehub_status: "success", voicehub_attempts: Number(delivery.attempts), voicehub_last_error: null, fulfilled_at: new Date().toISOString() });
      } catch (error) { const message = error instanceof Error ? error.message : String(error); await deliveries.markFailed(Number(delivery.id), message); await orders.updateUnit(Number(unit.id), { status: "failed", voicehub_status: "failed", voicehub_attempts: Number(delivery.attempts), voicehub_last_error: message }); }
      await orders.recalcFulfillmentStatus(orderId); count++;
    }
    await orders.recalcFulfillmentStatus(orderId); return count;
  };
  // Settings migrated from the PHP panel store secrets as `v1:` ciphertext.
  const secret = (key: string, fallback = ""): string => {
    const raw = config.get(key, fallback);
    if (raw === "" || !raw.startsWith("v1:")) return raw;
    try { return crypto.decrypt(raw); } catch { return raw; }
  };
  return {
    fulfillment: { async process(limit: number): Promise<number> { let total = 0; for (const order of await orders.listPendingFulfillment(limit)) total += await processOrder(Number(order.id)); return total; } },
    afdian: { async poll(limit: number): Promise<number> {
      if (!config.bool("AFDIAN_ENABLED", true)) return 0;
      // 只用 Webhook 时可关闭主动轮询，省调用/省 token。
      if (!config.bool("AFDIAN_POLL_ENABLED", true)) return 0;
      const userId = config.get("AFDIAN_USER_ID"); if (!userId) throw new Error("AFDIAN_USER_ID is required");
      const token = secret("AFDIAN_API_TOKEN"); if (!token) throw new Error("AFDIAN_API_TOKEN is required");
      const boundedLimit = Math.max(1, Math.min(limit, config.int("AFDIAN_POLL_LIMIT", 20)));
      const perPage = Math.max(1, Math.min(config.int("AFDIAN_POLL_PER_PAGE", Math.min(boundedLimit, 50)), 100));
      const base = config.get("AFDIAN_API_BASE", "https://ifdian.net").replace(/\/+$/, "");
      const endpoint = `${base}${config.get("AFDIAN_ORDER_ENDPOINT", "/api/open/query-order")}`;
      const makePayload = (params: Record<string, unknown>) => {
        const payload: Record<string, string | number> = { user_id: userId, params: JSON.stringify(params), ts: Math.floor(Date.now() / 1000) };
        const kv = Object.keys(payload).sort().map((key) => key + payload[key]).join("");
        return { ...payload, sign: createHash("md5").update(token + kv).digest("hex") };
      };
      const normalize = (raw: Record<string, unknown>) => {
        const out = String(raw.out_trade_no ?? raw.order_no ?? raw.order_id ?? ""); if (!out) return null;
        const statusRaw = String(raw.status ?? "2");
        const amount = raw.total_amount ?? raw.amount ?? raw.show_amount ?? "0";
        let cents: number;
        try { cents = toCents(String(amount)); } catch { throw new Error("Afdian order has invalid amount"); }
        if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Afdian order has invalid amount");
        const sku = Array.isArray(raw.sku_detail) ? raw.sku_detail.map((item) => { const s = item as Record<string, unknown>; const name = String(s.name ?? ""); return name ? `${name} x${String(s.count ?? "")}` : ""; }).filter(Boolean).join(", ") : String(raw.sku_detail ?? "");
        const timestamp = raw.create_time ?? raw.createTime; const seconds = typeof timestamp === "object" ? 0 : Number(timestamp ?? 0);
        const time = seconds > 0 ? new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "+00:00") : null;
        return { out_trade_no: out, trade_no: String(raw.trade_no ?? ""), user_id: String(raw.user_private_id ?? raw.user_id ?? raw.buyer_id ?? ""), buyer_name: String(raw.user_name ?? raw.name ?? raw.buyer_name ?? "").trim(), remark: String(raw.remark ?? raw.order_msg ?? "").trim(), plan_id: String(raw.plan_id ?? ""), sku_detail: sku, amount_cents: cents, status: statusRaw === "2" ? "paid" : statusRaw, created_at: time, paid_at: statusRaw === "2" ? time : null, raw };
      };
      let fetched = 0; let processed = 0; let page = 1; let totalPages = 1;
      do {
        const params = { page, per_page: perPage };
        const response = await fetch(endpoint, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(makePayload(params)), signal: AbortSignal.timeout(20_000), redirect: "manual" });
        if (!response.ok) throw new Error(`Afdian polling failed with HTTP ${response.status}`);
        const envelope = await response.json() as Record<string, unknown>;
        if (Number(envelope.ec) !== 200) throw new Error(`Afdian polling failed: ${String(envelope.em ?? "unknown error")}`);
        const data = envelope.data && typeof envelope.data === "object" ? envelope.data as Record<string, unknown> : {};
        const list = Array.isArray(data.list) ? data.list : []; totalPages = Math.max(1, Number(data.total_page ?? totalPages));
        for (const item of list) {
          if (fetched >= boundedLimit) break;
          fetched++; if (!item || typeof item !== "object") continue;
          const normalized = normalize(item as Record<string, unknown>); if (!normalized) continue;
          const stored = await afdianOrders.createIfAbsent({ ...normalized, raw_payload: JSON.stringify(normalized.raw) });
          const order = stored.order; if (!order || !["paid", "2"].includes(String(order.status))) continue;
          if (order.voicehub_status === "success") continue;
          const code = String(order.out_trade_no); const key = `afdian:${code}`;
          const result = await deliveries.createIfAbsent({ source_type: "afdian", source_id: Number(order.id), source_order_no: code, fulfillment_unit_id: null, code_ciphertext: crypto.encrypt(code), code_hash: crypto.hash(code), code_source: "afdian_order_no", idempotency_key: key, status: "pending" });
          let delivery = result.delivery; if (!delivery || delivery.status === "success") { if (delivery) await afdianOrders.markVoiceHub(Number(order.id), "success", Number(delivery.attempts), null); continue; }
          const maxAttempts = Math.max(1, config.int("VOICEHUB_RETRIES", 3)); if (Number(delivery.attempts) >= maxAttempts) continue;
          const payload = JSON.stringify({ codes: [code] }); if (!await deliveries.claimForProcessing(Number(delivery.id), payload, maxAttempts)) continue;
          delivery = await deliveries.findById(Number(delivery.id)) ?? delivery;
          await afdianOrders.markVoiceHub(Number(order.id), "processing", Number(delivery.attempts), null);
          try {
            const voiceEndpoint = `${config.get("VOICEHUB_API_BASE").replace(/\/+$/, "")}${config.get("VOICEHUB_TICKET_ENDPOINT", "/api/open/card-codes")}`;
            const pushed = await fetch(voiceEndpoint, { method: "POST", headers: { "x-api-key": secret("VOICEHUB_API_TOKEN"), Accept: "application/json", "Content-Type": "application/json" }, body: payload, signal: AbortSignal.timeout(Math.max(5, config.int("VOICEHUB_TIMEOUT", 20)) * 1000), redirect: "manual" });
            const body = await pushed.text(); let parsed: Record<string, unknown>; try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { parsed = { raw: body }; }
            const message = String(parsed.message ?? parsed.error ?? ""); const exists = /点歌券已经存在|无需重复创建|已存在|already exists|already created/i.test(message);
            if (pushed.status >= 400 && !exists) throw new Error(`VoiceHub rejected request (HTTP ${pushed.status})`);
            if (parsed.success !== undefined && parsed.success !== true && Number(parsed.code ?? 0) !== 0 && !exists) throw new Error("VoiceHub rejected request");
            await deliveries.markSuccess(Number(delivery.id), JSON.stringify(parsed)); await afdianOrders.markVoiceHub(Number(order.id), "success", Number(delivery.attempts), null); processed++;
          } catch (error) { const message = error instanceof Error ? error.message : String(error); await deliveries.markFailed(Number(delivery.id), message); await afdianOrders.markVoiceHub(Number(order.id), "failed", Number(delivery.attempts), message); }
        }
        page++;
      } while (fetched < boundedLimit && page <= totalPages);
      return processed;
    } },
    reservations: { async releaseExpiredUnpaid(limit: number): Promise<number> { const released = await inventory.releaseExpired(new Date().toISOString()); const cancelled = await shop.expireUnpaidOrders(limit); void close; return released + cancelled; } },
  };
}
