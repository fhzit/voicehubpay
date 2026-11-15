/**
 * `/admin/voicehub` — delivery log, failure centre and retries
 * (port of Admin\VoiceHubController).
 */

import type { AdminRouter } from "./router.js";
import { formInt, formString, pagination } from "./router.js";
import type { Row } from "./types.js";

const PER_PAGE = 20;

export function registerVoiceHubRoutes(router: AdminRouter): void {
  const deps = router.deps;

  router.get("/admin/voicehub", async (context) => {
    const { query } = context;
    const filters = {
      status: formString(query, "status"),
      code_source: formString(query, "code_source"),
      q: formString(query, "q"),
    };
    const requested = Math.max(1, formInt(query, "page", 1));
    const result = await deps.voicehubDeliveries.list(filters, requested, PER_PAGE);
    const { page, pages } = pagination(query, result.perPage, result.total);

    return context.render("voicehub/index", {
      pageTitle: "VoiceHub 发货",
      nav: "voicehub",
      deliveries: result.items.map((row) => ({ ...row, code_masked: mask(deps, row["code_ciphertext"]) })),
      total: result.total,
      page,
      pages,
      filters,
      stats: await statsWithTotals(router),
    });
  });

  router.get("/admin/voicehub/failures", async (context) => {
    const { query } = context;
    const requested = Math.max(1, formInt(query, "page", 1));
    const result = await deps.voicehubDeliveries.list({ only_failed: true, q: formString(query, "q") }, requested, PER_PAGE);
    const { page, pages } = pagination(query, result.perPage, result.total);
    return context.render("voicehub/failures", {
      pageTitle: "VoiceHub 失败中心",
      nav: "voicehub",
      deliveries: result.items.map((row) => ({ ...row, code_masked: mask(deps, row["code_ciphertext"]) })),
      total: result.total,
      page,
      pages,
    });
  });

  router.post("/admin/voicehub/retry", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deliveryId = formInt(context.body, "delivery_id", 0);
    const delivery = await deps.voicehubDeliveries.findById(deliveryId);
    if (delivery === null) return context.redirect("/admin/voicehub", "推送记录不存在。", "error");

    if (String(delivery["source_type"] ?? "") === "afdian") {
      if (deps.afdianProcessor === undefined) {
        return context.redirect("/admin/voicehub", "爱发电处理器未配置，无法重试。", "error");
      }
      await deps.afdianProcessor.retry(String(delivery["source_order_no"] ?? ""));
      await context.audit("voicehub.retry", "delivery", String(deliveryId), { source: "afdian" });
      return context.redirect("/admin/voicehub", "已重试该爱发电推送。");
    }

    if (delivery["fulfillment_unit_id"] !== null && delivery["fulfillment_unit_id"] !== undefined) {
      if (deps.fulfillment === undefined) {
        return context.redirect("/admin/voicehub", "发货服务未配置，无法重试。", "error");
      }
      await deps.fulfillment.retryUnit(Number(delivery["fulfillment_unit_id"]));
      await context.audit("voicehub.retry", "delivery", String(deliveryId), { source: "shop" });
      return context.redirect("/admin/voicehub", "已重试该商城推送。");
    }

    return context.redirect("/admin/voicehub", "无法重试该记录。", "error");
  });

  router.post("/admin/voicehub/retry-all", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    if (deps.fulfillment?.processPendingOrders === undefined) {
      return context.redirect("/admin/voicehub/failures", "批量重试服务未配置。", "error");
    }
    // Still one HTTP request per code — never batched (PHP parity).
    const summary = await deps.fulfillment.processPendingOrders(100);
    await context.audit("voicehub.retry_all", "voicehub", "all", { ...(summary ?? {}) });
    return context.redirect(
      "/admin/voicehub/failures",
      `批量重试完成：处理 ${Number(summary?.processed ?? 0)} 个单元，成功 ${Number(summary?.success ?? 0)}，失败 ${Number(summary?.failed ?? 0)}。`,
    );
  });
}

async function statsWithTotals(router: AdminRouter): Promise<Record<string, number>> {
  const deps = router.deps;
  const stats = await deps.voicehubDeliveries.stats().catch((): Record<string, number> => ({}));
  const total = Object.values(stats).reduce((sum, value) => sum + Number(value ?? 0), 0);
  const successToday = await deps.voicehubDeliveries.countTodayByStatus("success").catch(() => 0);
  const failedToday = await deps.voicehubDeliveries.countTodayByStatus("failed").catch(() => 0);
  return { ...stats, total, today: successToday + failedToday };
}

function mask(deps: AdminRouter["deps"], ciphertext: unknown): string {
  if (typeof ciphertext !== "string" || ciphertext === "") return "";
  try {
    return deps.crypto.mask(deps.crypto.decrypt(ciphertext));
  } catch {
    return "";
  }
}

export type { Row };
