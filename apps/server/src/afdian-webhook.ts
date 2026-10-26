import { createVerify } from "node:crypto";
import type { FastifyInstance } from "fastify";

/** PHP-parity HTTP adapter. The processing port is supplied by the existing Afdian processor boundary. */
export interface AfdianWebhookDependencies {
  enabled(): boolean;
  requireSignature(): boolean;
  publicKey: string;
  processNormalizedOrder(order: Record<string, unknown>): Promise<{ status: string }>;
}

export function configureAfdianWebhook(app: FastifyInstance, deps: AfdianWebhookDependencies): void {
  app.post("/webhook/afdian", async (request, reply) => {
    if (!deps.enabled()) return reply.code(503).send({ ec: 503, em: "disabled" });
    const payload = request.body as Record<string, unknown> | undefined;
    const data = payload?.data as Record<string, unknown> | undefined;
    const order = data?.order as Record<string, unknown> | undefined;
    if (!order || typeof order !== "object" || Array.isArray(order)) return reply.code(422).send({ ec: 422, em: "order not found in payload" });
    const signature = payload?.sign ?? data?.sign ?? order.sign;
    if (typeof signature !== "string" || !signature) {
      if (deps.requireSignature()) return reply.code(401).send({ ec: 401, em: "invalid signature" });
    } else {
      let valid = false;
      try {
        const bytes = Buffer.from(signature, "base64");
        if (bytes.length > 0 && bytes.toString("base64") === signature) {
          const verifier = createVerify("RSA-SHA256");
          verifier.update(String(order.out_trade_no ?? "") + String(order.user_id ?? "") + String(order.plan_id ?? "") + String(order.total_amount ?? ""));
          verifier.end();
          valid = verifier.verify(deps.publicKey, bytes);
        }
      } catch { valid = false; }
      if (!valid) return reply.code(401).send({ ec: 401, em: "invalid signature" });
    }
    if ((data?.type ?? "order") !== "order") return reply.code(422).send({ ec: 422, em: "order not found in payload" });
    const cents = Number(order.total_amount ?? order.amount ?? order.show_amount ?? 0);
    if (!Number.isFinite(cents) || cents < 0) return reply.code(422).send({ ec: 422, em: "invalid amount" });
    const rawStatus = String(order.status ?? "2");
    const normalized = {
      out_trade_no: String(order.out_trade_no ?? order.order_no ?? order.order_id ?? ""),
      trade_no: String(order.trade_no ?? ""), user_id: String(order.user_private_id ?? order.user_id ?? order.buyer_id ?? ""),
      buyer_name: String(order.user_name ?? order.name ?? order.buyer_name ?? "").trim(), remark: String(order.remark ?? order.order_msg ?? "").trim(),
      plan_id: String(order.plan_id ?? ""), sku_detail: typeof order.sku_detail === "string" ? order.sku_detail : "",
      amount_cents: Math.round(cents * 100), status: rawStatus === "2" ? "paid" : rawStatus,
      created_at: null, paid_at: rawStatus === "2" ? null : null, raw: order,
    };
    if (!normalized.out_trade_no) return reply.code(422).send({ ec: 422, em: "order not found in payload" });
    try {
      const result = await deps.processNormalizedOrder(normalized);
      return reply.code(200).send({ ec: 200, em: "", status: result.status });
    } catch {
      return reply.code(500).send({ ec: 500, em: "internal error" });
    }
  });
}
