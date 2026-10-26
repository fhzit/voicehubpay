import type { AfdianOrderRepository, CryptoService, VoiceHubDeliveryRepository } from "../../../packages/db/src/index.js";

/** Persist each notification and enqueue paid orders for the shared delivery worker. */
export function createAfdianWebhookProcessor(
  orders: AfdianOrderRepository,
  deliveries: VoiceHubDeliveryRepository,
  crypto: CryptoService,
): (order: Record<string, unknown>) => Promise<{ status: string }> {
  return async (order) => {
    const stored = await orders.createIfAbsent({
      ...order,
      out_trade_no: String(order.out_trade_no),
      raw_payload: JSON.stringify(order.raw ?? order),
    });
    if (!stored.order) throw new Error("Afdian order persistence failed");
    const row = stored.order;
    if (!["paid", "2"].includes(String(row.status))) return { status: "unpaid" };
    const code = String(row.out_trade_no);
    const result = await deliveries.createIfAbsent({
      source_type: "afdian", source_id: Number(row.id), source_order_no: code,
      fulfillment_unit_id: null, code_ciphertext: crypto.encrypt(code), code_hash: crypto.hash(code),
      code_source: "afdian_order_no", idempotency_key: `afdian:${code}`, status: "pending",
    });
    if (!result.delivery) throw new Error("Afdian delivery persistence failed");
    if (result.delivery.status === "success") return { status: "already_success" };
    return { status: "success" };
  };
}
