/**
 * `/admin/afdian` — Afdian order ledger, manual sync and retry
 * (port of Admin\AfdianController).
 */

import type { AdminRouter } from "./router.js";
import { formInt, formString, pagination } from "./router.js";

const PER_PAGE = 20;

export function registerAfdianRoutes(router: AdminRouter): void {
  const deps = router.deps;

  router.get("/admin/afdian", async (context) => {
    const { query } = context;
    const status = formString(query, "status");
    const voicehub = formString(query, "voicehub");
    const q = formString(query, "q");
    const requested = Math.max(1, formInt(query, "page", 1));
    const result = await deps.afdianOrders.listAdmin(status, voicehub, q, requested, PER_PAGE);
    const { page, pages } = pagination(query, result.perPage, result.total);
    return context.render("afdian/index", {
      pageTitle: "爱发电订单",
      nav: "afdian",
      orders: result.items,
      total: result.total,
      page,
      pages,
      status,
      voicehub,
      q,
      stats: {
        sum: await deps.afdianOrders.sumPaid().catch(() => 0),
        today_sum: await deps.afdianOrders.sumToday().catch(() => 0),
        today_orders: await deps.afdianOrders.countToday().catch(() => 0),
        voicehub: await deps.afdianOrders.stats().catch((): Record<string, number> => ({})),
      },
    });
  });

  router.post("/admin/afdian/sync", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    if (deps.afdianProcessor === undefined) {
      return context.redirect("/admin/afdian", "爱发电处理器未配置，无法同步。", "error");
    }
    // 同步要逐条拉单 + 推 VoiceHub，耗时可能超过 Cloudflare 的 100 秒超时（表现为 524）。
    // 改为后台执行：立刻返回，页面刷新即可看到结果。
    const processor = deps.afdianProcessor;
    void processor
      .processPoll()
      .then(async (results) => {
        const success = results.filter((entry) => entry.status === "success").length;
        const failed = results.filter((entry) => entry.status === "failed").length;
        console.info(JSON.stringify({ event: "afdian.sync", total: results.length, success, failed }));
      })
      .catch((error: unknown) => {
        console.error(JSON.stringify({ event: "afdian.sync.failed", error: errorMessage(error) }));
      });
    return context.redirect("/admin/afdian", "已在后台开始同步，约 10~60 秒后刷新本页查看结果。");
  });

  router.post("/admin/afdian/retry", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const outTradeNo = formString(context.body, "out_trade_no");
    const force = formInt(context.body, "force", 0) === 1;
    if (deps.afdianProcessor === undefined) {
      return context.redirect("/admin/afdian", "爱发电处理器未配置，无法重试。", "error");
    }
    try {
      const result = await deps.afdianProcessor.retry(outTradeNo, force);
      await context.audit("afdian.retry", "afdian", outTradeNo, { result: result.status ?? "" });
      const status = String(result.status ?? "");
      const messages: Record<string, string> = {
        success: `推送成功（VoiceHub code = ${outTradeNo}）。`,
        already_success: "该订单已成功，未重复推送。",
        failed: `推送失败：${result.message ?? ""}`,
      };
      const message = messages[status] ?? `处理结果：${status}`;
      return context.redirect("/admin/afdian", message, status === "failed" ? "error" : "success");
    } catch (error) {
      return context.redirect("/admin/afdian", `重试失败：${errorMessage(error)}`, "error");
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
