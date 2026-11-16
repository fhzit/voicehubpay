/**
 * 后台「爱发电订单 → 手动同步 / 重试」的服务端处理器。
 *
 * 后台此前只判定 `deps.afdianProcessor === undefined` 就提示“未配置”，
 * 但从来没有真正装配过这个端口 —— 于是即使爱发电已配置好，点手动同步也永远
 * 报未配置。这里补齐真实实现：拉取订单 → 入库 → 幂等创建发券记录 → 推 VoiceHub。
 *
 * 签名规则与 worker 一致：md5(token + 按 key 升序拼接的 k+v)。
 */

import { createHash } from "node:crypto";
import type { AdminConfigPort } from "./admin/types.js";
import type { AfdianOrderRepository, CryptoService, VoiceHubDeliveryRepository } from "../../../packages/db/src/index.js";

type Row = Record<string, unknown>;

export interface AfdianAdminProcessorDeps {
  config: AdminConfigPort;
  orders: AfdianOrderRepository;
  deliveries: VoiceHubDeliveryRepository;
  crypto: CryptoService;
  /** 测试注入点；默认全局 fetch。 */
  fetchImpl?: typeof fetch;
}

interface PollResult {
  status: string;
  out_trade_no?: string;
  message?: string;
}

const DEFAULT_BASE = "https://ifdian.net";
const DEFAULT_ENDPOINT = "/api/open/query-order";

export function createAfdianAdminProcessor(deps: AfdianAdminProcessorDeps) {
  const { config, orders, deliveries, crypto } = deps;
  const doFetch = deps.fetchImpl ?? fetch;

  const token = (): string => config.get("AFDIAN_API_TOKEN", "").trim();
  const userId = (): string => config.get("AFDIAN_USER_ID", "").trim();

  const endpoint = (): string => {
    const base = (config.get("AFDIAN_API_BASE", DEFAULT_BASE) || DEFAULT_BASE).replace(/\/+$/, "");
    const path = config.get("AFDIAN_ORDER_ENDPOINT", DEFAULT_ENDPOINT) || DEFAULT_ENDPOINT;
    return `${base}${path}`;
  };

  function assertConfigured(): void {
    if (!config.bool("AFDIAN_ENABLED", true)) throw new Error("爱发电对接未启用，请先在「设置 → 爱发电」中开启。");
    if (token() === "") throw new Error("爱发电 API Token 未填写。");
    if (userId() === "") throw new Error("爱发电 User ID 未填写。");
  }

  function signedPayload(params: Record<string, unknown>): Record<string, string> {
    const payload: Record<string, string | number> = {
      user_id: userId(),
      params: JSON.stringify(params),
      ts: Math.floor(Date.now() / 1000),
    };
    const concatenated = Object.keys(payload).sort().map((key) => key + String(payload[key])).join("");
    return {
      user_id: String(payload.user_id),
      params: String(payload.params),
      ts: String(payload.ts),
      sign: createHash("md5").update(token() + concatenated).digest("hex"),
    };
  }

  async function requestPage(page: number, perPage: number): Promise<{ list: Row[]; totalPages: number }> {
    const body = new URLSearchParams(signedPayload({ page, per_page: perPage })).toString();
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await doFetch(endpoint(), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error(`爱发电接口返回 HTTP ${response.status}`);
        const envelope = (await response.json()) as Row;
        if (Number(envelope["ec"]) !== 200) throw new Error(`爱发电接口错误：${String(envelope["em"] ?? "未知错误")}`);
        const data = (envelope["data"] ?? {}) as Row;
        const list = Array.isArray(data["list"]) ? (data["list"] as Row[]) : [];
        return { list, totalPages: Math.max(1, Number(data["total_page"] ?? 1)) };
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => { setTimeout(resolve, 400 * attempt); });
      }
    }
    throw lastError instanceof Error ? lastError : new Error("爱发电接口请求失败");
  }

  function normalize(raw: Row): (Row & { out_trade_no: string }) | null {
    const out = String(raw["out_trade_no"] ?? raw["order_no"] ?? raw["order_id"] ?? "");
    if (out === "") return null;
    const statusRaw = String(raw["status"] ?? "2");
    const amount = String(raw["total_amount"] ?? raw["amount"] ?? raw["show_amount"] ?? "0");
    const cents = Math.round(Number.parseFloat(amount || "0") * 100);
    if (!Number.isFinite(cents) || cents < 0) return null;
    const sku = Array.isArray(raw["sku_detail"])
      ? (raw["sku_detail"] as Row[]).map((item) => `${String(item["name"] ?? "")} x${String(item["count"] ?? "")}`).filter(Boolean).join(", ")
      : String(raw["sku_detail"] ?? "");
    const created = Number(raw["create_time"] ?? 0);
    return {
      out_trade_no: out,
      trade_no: String(raw["trade_no"] ?? ""),
      user_id: String(raw["user_private_id"] ?? raw["user_id"] ?? ""),
      buyer_name: String(raw["user_name"] ?? raw["name"] ?? "").trim(),
      remark: String(raw["remark"] ?? raw["order_msg"] ?? "").trim(),
      plan_id: String(raw["plan_id"] ?? ""),
      sku_detail: sku,
      amount_cents: cents,
      status: statusRaw === "2" ? "paid" : statusRaw,
      created_at: created > 0 ? new Date(created * 1000).toISOString().replace(/\.\d{3}Z$/, "+00:00") : null,
      paid_at: statusRaw === "2" && created > 0 ? new Date(created * 1000).toISOString().replace(/\.\d{3}Z$/, "+00:00") : null,
    };
  }

  /** 把单条发券记录推到 VoiceHub；已存在视为成功。 */
  async function push(code: string): Promise<{ ok: boolean; message: string; payload: string }> {
    const voiceBase = config.get("VOICEHUB_API_BASE", "").replace(/\/+$/, "");
    const voiceToken = config.get("VOICEHUB_API_TOKEN", "").trim();
    if (voiceBase === "" || voiceToken === "") return { ok: false, message: "VoiceHub 未配置", payload: "{}" };
    const url = `${voiceBase}${config.get("VOICEHUB_TICKET_ENDPOINT", "/api/open/card-codes")}`;
    const response = await doFetch(url, {
      method: "POST",
      headers: { "x-api-key": voiceToken, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ codes: [code] }),
      signal: AbortSignal.timeout(Math.max(5, config.int("VOICEHUB_TIMEOUT", 20)) * 1000),
    });
    const text = await response.text();
    let parsed: Row = {};
    try { parsed = JSON.parse(text) as Row; } catch { parsed = { raw: text }; }
    const message = String(parsed["message"] ?? parsed["error"] ?? text.slice(0, 200));
    const exists = /点歌券已经存在|无需重复创建|已存在|already exists|already created/i.test(message);
    if (response.status >= 400 && !exists) return { ok: false, message: message || `HTTP ${response.status}`, payload: text.slice(0, 2000) };
    if (parsed["success"] !== undefined && parsed["success"] !== true && Number(parsed["code"] ?? 0) !== 0 && !exists) {
      return { ok: false, message: message || "VoiceHub 拒绝请求", payload: text.slice(0, 2000) };
    }
    return { ok: true, message, payload: text.slice(0, 2000) };
  }

  /** 入库并尽力发券；返回该订单的处理结果。 */
  async function handleOrder(raw: Row): Promise<PollResult | null> {
    const normalized = normalize(raw);
    if (normalized === null) return null;
    const stored = await orders.createIfAbsent({ ...normalized, raw_payload: JSON.stringify(raw) });
    const order = stored.order;
    if (order === null) return null;
    const code = String(order["out_trade_no"]);
    if (!["paid", "2"].includes(String(order["status"]))) return { status: "unpaid", out_trade_no: code };
    if (String(order["voicehub_status"] ?? "") === "success") return { status: "already_success", out_trade_no: code };

    const created = await deliveries.createIfAbsent({
      source_type: "afdian",
      source_id: Number(order["id"]),
      source_order_no: code,
      fulfillment_unit_id: null,
      code_ciphertext: crypto.encrypt(code),
      code_hash: crypto.hash(code),
      code_source: "afdian_order_no",
      idempotency_key: `afdian:${code}`,
      status: "pending",
    });
    const delivery = created.delivery;
    if (delivery === null) return { status: "failed", out_trade_no: code, message: "发券记录创建失败" };
    if (String(delivery["status"]) === "success") {
      await orders.markVoiceHub(Number(order["id"]), "success", Number(delivery["attempts"] ?? 0), null);
      return { status: "already_success", out_trade_no: code };
    }

    const maxAttempts = Math.max(1, config.int("VOICEHUB_RETRIES", 3));
    const claimed = await deliveries.claimForProcessing(Number(delivery["id"]), JSON.stringify({ codes: [code] }), maxAttempts, true);
    if (!claimed) return { status: "failed", out_trade_no: code, message: "发券记录正被占用" };
    await orders.markVoiceHub(Number(order["id"]), "processing", Number(delivery["attempts"] ?? 0) + 1, null);
    try {
      const result = await push(code);
      if (!result.ok) throw new Error(result.message);
      await deliveries.markSuccess(Number(delivery["id"]), result.payload);
      await orders.markVoiceHub(Number(order["id"]), "success", Number(delivery["attempts"] ?? 0) + 1, null);
      return { status: "success", out_trade_no: code };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deliveries.markFailed(Number(delivery["id"]), message);
      await orders.markVoiceHub(Number(order["id"]), "failed", Number(delivery["attempts"] ?? 0) + 1, message);
      return { status: "failed", out_trade_no: code, message };
    }
  }

  return {
    /** 拉取最近订单（受 AFDIAN_POLL_LIMIT 限制），逐条入库并发券。 */
    async processPoll(): Promise<PollResult[]> {
      assertConfigured();
      const limit = Math.max(1, Math.min(config.int("AFDIAN_POLL_LIMIT", 20), 50));
      const perPage = Math.max(1, Math.min(config.int("AFDIAN_POLL_PER_PAGE", 50), 100));
      const results: PollResult[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const { list, totalPages: pages } = await requestPage(page, perPage);
        totalPages = pages;
        for (const raw of list) {
          if (results.length >= limit) break;
          const outcome = await handleOrder(raw);
          if (outcome !== null) results.push(outcome);
        }
        page += 1;
      } while (results.length < limit && page <= totalPages);
      return results;
    },

    /** 重新推送指定订单的发券（force 时重置重试计数）。 */
    async retry(outTradeNo: string, force = false): Promise<{ status?: string; message?: string }> {
      assertConfigured();
      const order = await orders.findByOutTradeNo(outTradeNo);
      if (order === null) return { status: "not_found", message: "订单不存在" };
      if (!["paid", "2"].includes(String(order["status"]))) return { status: "unpaid", message: "订单未支付" };
      const delivery = await deliveries.findByIdempotencyKey(`afdian:${outTradeNo}`);
      if (delivery === null) return { status: "no_delivery", message: "没有发券记录，请先手动同步" };
      if (force) await deliveries.update(Number(delivery["id"]), { attempts: 0, status: "pending", last_error: null });
      const result = await push(outTradeNo);
      if (!result.ok) {
        await deliveries.markFailed(Number(delivery["id"]), result.message, result.payload);
        await orders.markVoiceHub(Number(order["id"]), "failed", Number(delivery["attempts"] ?? 0) + 1, result.message);
        return { status: "failed", message: result.message };
      }
      await deliveries.markSuccess(Number(delivery["id"]), result.payload);
      await orders.markVoiceHub(Number(order["id"]), "success", Number(delivery["attempts"] ?? 0) + 1, null);
      return { status: "success" };
    },
  };
}
