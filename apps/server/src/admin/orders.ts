/**
 * `/admin/orders` — listing, detail and the manual operations
 * (port of VoiceHubPay\Controllers\Admin\OrderController).
 *
 * Fulfillment / SG65 / cancellation side effects live behind optional seams
 * (`fulfillment`, `paymentService`, `shopService`). When a seam is not wired
 * the action answers with an explanatory flash instead of half-applying.
 */

import { PasswordHasher } from "../auth-legacy/password-hasher.js";
import type { AdminContext, AdminRouter } from "./router.js";
import { formInt, formString, formTrimmed, pagination } from "./router.js";
import type { Row } from "./types.js";

const PER_PAGE = 20;

export function registerOrderRoutes(router: AdminRouter): void {
  router.get("/admin/orders", async (context) => {
    const { query } = context;
    const filters = {
      order_no: formString(query, "order_no"),
      username: formString(query, "username"),
      product: formString(query, "product"),
      payment_status: formString(query, "payment_status"),
      fulfillment_status: formString(query, "fulfillment_status"),
      abnormal: formString(query, "abnormal"),
      from: formString(query, "from"),
      to: formString(query, "to"),
    };
    const requested = Math.max(1, formInt(query, "page", 1));
    const result = await router.deps.orders.listAdmin(filters, requested, PER_PAGE);
    const { page, pages } = pagination(query, result.perPage, result.total);
    return context.render("orders/index", {
      pageTitle: "订单管理",
      nav: "orders",
      orders: result.items,
      total: result.total,
      page,
      pages,
      filters,
    });
  });

  router.get("/admin/orders/:orderNo", async (context) => {
    const deps = router.deps;
    const orderNo = String(context.params["orderNo"] ?? "");
    const order = await deps.orders.orderWithItems(orderNo);
    if (order === null) return context.redirect("/admin/orders", "订单不存在。", "error");

    const orderId = Number(order["id"]);
    const user = await deps.users.findById(Number(order["user_id"]));
    const payments = await deps.payments.listForOrder(orderId);
    const unitStats = await deps.orders.countUnitsByStatus(orderId);

    const units: Array<{ unit: Row; delivery: Row | null; code_masked: string; delivery_masked: string }> = [];
    for (const unit of order.units) {
      const delivery = deps.voicehubDeliveries.findByUnitId !== undefined
        ? await deps.voicehubDeliveries.findByUnitId(Number(unit["id"]))
        : null;
      units.push({
        unit,
        delivery,
        code_masked: mask(deps, unit["delivery_code_ciphertext"]),
        delivery_masked: delivery !== null ? mask(deps, delivery["code_ciphertext"]) : "",
      });
    }

    const recentAudit = deps.audit !== undefined
      ? (await deps.audit.list({ object_type: "order", q: orderNo }, 1, 20)).items
      : [];

    return context.render("orders/detail", {
      pageTitle: `订单 ${orderNo}`,
      nav: "orders",
      order,
      user,
      payments,
      unit_stats: unitStats,
      units,
      recent_audit: recentAudit,
      inventory_available: await availableForOrder(router, order),
    });
  });

  // ------------------------------------------------------------ manual ops

  router.post("/admin/orders/query-payment", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const order = await orderFromRequest(router, context);
    if (order === null) return context.redirect("/admin/orders", "订单不存在。", "error");
    const orderNo = String(order["order_no"] ?? "");
    if (deps.paymentService?.queryAndBackfill === undefined) {
      return context.redirect(`/admin/orders/${orderNo}`, "支付查询服务未配置。", "error");
    }
    try {
      const result = await deps.paymentService.queryAndBackfill(order);
      await context.audit("order.query_sg65", "order", orderNo, { status: result.status });
      const message = result.paid
        ? "SG65 已确认支付，订单已入账。"
        : `SG65 返回状态：${result.status}（0未支付 1已支付 2已退款 3冻结 4预授权）`;
      return context.redirect(`/admin/orders/${orderNo}`, message, result.paid ? "success" : "warning");
    } catch (error) {
      return context.redirect(`/admin/orders/${orderNo}`, `查询失败：${errorMessage(error)}`, "error");
    }
  });

  router.post("/admin/orders/manual-confirm", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const order = await orderFromRequest(router, context);
    if (order === null) return context.redirect("/admin/orders", "订单不存在。", "error");
    const orderNo = String(order["order_no"] ?? "");
    if (String(order["payment_status"] ?? "") === "paid") {
      return context.redirect(`/admin/orders/${orderNo}`, "订单已是已支付状态。", "warning");
    }
    const reason = formTrimmed(context.body, "reason");
    if (reason === "") return context.redirect(`/admin/orders/${orderNo}`, "请填写处理原因。", "error");
    const password = formString(context.body, "admin_password");
    const valid = await PasswordHasher.verify(password, String(context.user["password_hash"] ?? ""));
    if (!valid) {
      return context.redirect(`/admin/orders/${orderNo}`, "管理员密码验证失败，操作已取消。", "error");
    }

    if (deps.paymentService !== undefined) {
      await deps.paymentService.confirmPaid(order, "manual", "manual");
    } else {
      // Degraded mode: mark the order paid directly (no mail/fulfilment hooks).
      await deps.orders.markPaid(Number(order["id"]), Number(order["amount_due_cents"] ?? 0), "manual", "manual");
    }
    await context.audit("order.manual_confirm", "order", orderNo, {
      amount_cents: Number(order["amount_due_cents"] ?? 0),
      reason,
      source: "manual",
    });
    return context.redirect(`/admin/orders/${orderNo}`, "已人工确认入账。");
  });

  router.post("/admin/orders/cancel", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const order = await orderFromRequest(router, context);
    if (order === null) return context.redirect("/admin/orders", "订单不存在。", "error");
    const orderNo = String(order["order_no"] ?? "");
    const reason = formTrimmed(context.body, "reason");
    if (reason === "") return context.redirect(`/admin/orders/${orderNo}`, "请填写处理原因。", "error");
    try {
      if (deps.shopService !== undefined) {
        await deps.shopService.cancelUnpaidOrder(Number(order["id"]), reason);
      } else {
        await deps.inventory.releaseForOrder(Number(order["id"]));
        await deps.orders.update(Number(order["id"]), { order_status: "cancelled", cancelled_at: nowIso() });
      }
      await context.audit("order.cancel", "order", orderNo, { reason });
      return context.redirect(`/admin/orders/${orderNo}`, "订单已取消，库存已释放。");
    } catch (error) {
      return context.redirect(`/admin/orders/${orderNo}`, errorMessage(error), "error");
    }
  });

  router.post("/admin/orders/process", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const order = await orderFromRequest(router, context);
    if (order === null) return context.redirect("/admin/orders", "订单不存在。", "error");
    const orderNo = String(order["order_no"] ?? "");
    if (deps.fulfillment === undefined) {
      return context.redirect(`/admin/orders/${orderNo}`, "发货服务未配置。", "error");
    }
    const result = await deps.fulfillment.processOrder(Number(order["id"]));
    await context.audit("order.process", "order", orderNo, { ...(result ?? {}) });
    return context.redirect(`/admin/orders/${orderNo}`, `处理完成：成功 ${Number(result?.success ?? 0)}，失败 ${Number(result?.failed ?? 0)}。`);
  });

  router.post("/admin/orders/retry-failed", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const order = await orderFromRequest(router, context);
    if (order === null) return context.redirect("/admin/orders", "订单不存在。", "error");
    const orderNo = String(order["order_no"] ?? "");
    if (deps.fulfillment === undefined) {
      return context.redirect(`/admin/orders/${orderNo}`, "发货服务未配置。", "error");
    }
    const result = await deps.fulfillment.processOrder(Number(order["id"]));
    await context.audit("order.retry_failed", "order", orderNo, { ...(result ?? {}) });
    return context.redirect(`/admin/orders/${orderNo}`, "已重试失败项。");
  });

  router.post("/admin/orders/retry-unit", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const unitId = formInt(context.body, "unit_id", 0);
    const force = formInt(context.body, "force", 0) === 1;
    const reason = formTrimmed(context.body, "reason");
    const orderNo = formString(context.body, "order_no");
    if (force && reason === "") {
      return context.redirect(`/admin/orders/${orderNo}`, "强制重推需要填写原因。", "error");
    }
    const unit = await deps.orders.findUnit(unitId);
    if (unit === null) return context.redirect(`/admin/orders/${orderNo}`, "发放单元不存在。", "error");
    if (!force && String(unit["voicehub_status"] ?? "") === "success") {
      return context.redirect(`/admin/orders/${orderNo}`, "该单元已成功，普通重试已禁用。如需重发请使用“强制重新推送”。", "warning");
    }
    if (deps.fulfillment === undefined) {
      return context.redirect(`/admin/orders/${orderNo}`, "发货服务未配置。", "error");
    }
    try {
      const delivery = await deps.fulfillment.retryUnit(unitId, force);
      await context.audit(force ? "unit.force_retry" : "unit.retry", "unit", String(unitId), {
        order_no: orderNo,
        reason: force ? reason : "",
        result: String(delivery?.["status"] ?? ""),
      });
      const status = String(delivery?.["status"] ?? "");
      return context.redirect(`/admin/orders/${orderNo}`, status === "success" ? "推送成功。" : "推送已执行，请查看最新状态。", status === "success" ? "success" : "warning");
    } catch (error) {
      return context.redirect(`/admin/orders/${orderNo}`, `重试失败：${errorMessage(error)}`, "error");
    }
  });

  router.post("/admin/orders/unit-complete", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const unitId = formInt(context.body, "unit_id", 0);
    const reason = formTrimmed(context.body, "reason");
    const orderNo = formString(context.body, "order_no");
    if (reason === "") return context.redirect(`/admin/orders/${orderNo}`, "请填写处理原因。", "error");
    if (deps.fulfillment === undefined) {
      return context.redirect(`/admin/orders/${orderNo}`, "发货服务未配置。", "error");
    }
    try {
      await deps.fulfillment.manualCompleteUnit(unitId, reason);
      await context.audit("unit.manual_complete", "unit", String(unitId), { order_no: orderNo, reason });
      return context.redirect(`/admin/orders/${orderNo}`, "该单元已标记为人工完成。");
    } catch (error) {
      return context.redirect(`/admin/orders/${orderNo}`, errorMessage(error), "error");
    }
  });

  router.post("/admin/orders/complete", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const order = await orderFromRequest(router, context);
    if (order === null) return context.redirect("/admin/orders", "订单不存在。", "error");
    const orderNo = String(order["order_no"] ?? "");
    const reason = formTrimmed(context.body, "reason");
    if (reason === "") return context.redirect(`/admin/orders/${orderNo}`, "请填写处理原因。", "error");
    if (deps.fulfillment === undefined) {
      return context.redirect(`/admin/orders/${orderNo}`, "发货服务未配置。", "error");
    }
    const units = await deps.orders.units(Number(order["id"]));
    for (const unit of units) {
      if (!["success", "manual_completed"].includes(String(unit["status"] ?? ""))) {
        await deps.fulfillment.manualCompleteUnit(Number(unit["id"]), `order manual complete: ${reason}`);
      }
    }
    await context.audit("order.manual_complete", "order", orderNo, { reason });
    return context.redirect(`/admin/orders/${orderNo}`, "订单已整体标记为人工完成。");
  });

  router.post("/admin/orders/assign-code", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const unitId = formInt(context.body, "unit_id", 0);
    const code = formString(context.body, "code");
    const reason = formTrimmed(context.body, "reason");
    const orderNo = formString(context.body, "order_no");
    if (code.trim() === "") return context.redirect(`/admin/orders/${orderNo}`, "请输入卡密。", "error");
    if (reason === "") return context.redirect(`/admin/orders/${orderNo}`, "请填写处理原因。", "error");
    if (deps.fulfillment === undefined) {
      return context.redirect(`/admin/orders/${orderNo}`, "发货服务未配置。", "error");
    }
    try {
      await deps.fulfillment.assignManualCode(unitId, code);
      await context.audit("unit.assign_code", "unit", String(unitId), { order_no: orderNo, reason });
      return context.redirect(`/admin/orders/${orderNo}`, "卡密已分配并加密保存。");
    } catch (error) {
      return context.redirect(`/admin/orders/${orderNo}`, `分配失败：${errorMessage(error)}`, "error");
    }
  });

  router.post("/admin/orders/assign-inventory", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const order = await orderFromRequest(router, context);
    if (order === null) return context.redirect("/admin/orders", "订单不存在。", "error");
    const orderNo = String(order["order_no"] ?? "");
    const items = await deps.orders.items(Number(order["id"]));
    const item = items[0];
    if (item === undefined) return context.redirect(`/admin/orders/${orderNo}`, "订单无商品项。", "error");

    const productId = Number(item["product_id"]);
    const units = await deps.orders.units(Number(order["id"]));
    const missing = units.filter((unit) => unit["inventory_card_id"] === null
      && ["failed", "pending"].includes(String(unit["status"] ?? ""))
      && unit["delivery_code_ciphertext"] === null);
    if (missing.length === 0) {
      return context.redirect(`/admin/orders/${orderNo}`, "没有需要分配库存的单元。", "warning");
    }
    const available = await deps.inventory.countAvailable(productId);
    if (available < missing.length) {
      return context.redirect(`/admin/orders/${orderNo}`, `可售库存不足：需要 ${missing.length}，可售 ${available}。`, "error");
    }
    const reason = formTrimmed(context.body, "reason");
    if (reason === "") return context.redirect(`/admin/orders/${orderNo}`, "请填写处理原因。", "error");

    const cards = await deps.inventory.reserve(productId, missing.length, Number(order["id"]), nowIso(), true, deps.crypto);
    const mode = String(item["delivery_mode_snapshot"] ?? "card");
    let index = 0;
    for (const unit of missing) {
      const card = cards[index];
      index += 1;
      if (card === undefined) break;
      await deps.orders.updateUnit(Number(unit["id"]), {
        inventory_card_id: Number(card["id"]),
        delivery_code_ciphertext: card["secret_ciphertext"],
        delivery_code_hash: card["secret_hash"],
        status: "pending",
        voicehub_status: mode === "card_and_voicehub" ? "pending" : "not_required",
        voicehub_code_ciphertext: mode === "card_and_voicehub" ? card["secret_ciphertext"] : null,
        voicehub_code_hash: mode === "card_and_voicehub" ? card["secret_hash"] : null,
        manual_note: "admin_assigned_inventory",
      });
    }
    await deps.inventory.markSoldForOrder(Number(order["id"]));
    await context.audit("order.assign_inventory", "order", orderNo, { count: missing.length, reason });
    return context.redirect(`/admin/orders/${orderNo}`, `已分配 ${missing.length} 张库存卡密并开始发货。`);
  });

  router.post("/admin/orders/delete-unpaid", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const deps = router.deps;
    const order = await orderFromRequest(router, context);
    if (order === null) return context.redirect("/admin/orders", "订单不存在。", "error");
    const orderNo = String(order["order_no"] ?? "");
    if (String(order["payment_status"] ?? "") === "paid") {
      return context.redirect(`/admin/orders/${orderNo}`, "已支付订单不能删除。", "error");
    }
    // Release + soft-cancel; money-related rows are never hard deleted.
    await deps.inventory.releaseForOrder(Number(order["id"]));
    await deps.orders.update(Number(order["id"]), { order_status: "cancelled", cancelled_at: nowIso() });
    await deps.payments.markCancelledForOrder(Number(order["id"]));
    await context.audit("order.cancel", "order", orderNo, { reason: formTrimmed(context.body, "reason") || "admin_cancel" });
    return context.redirect("/admin/orders", "订单已取消并释放库存。");
  });
}

async function orderFromRequest(router: AdminRouter, context: AdminContext): Promise<Row | null> {
  const orderNo = formString(context.body, "order_no");
  if (orderNo === "") return null;
  return router.deps.orders.findByOrderNo(orderNo);
}

async function availableForOrder(router: AdminRouter, order: Row & { items?: Row[] }): Promise<number> {
  const items = order.items ?? [];
  const first = items[0];
  if (first === undefined) return 0;
  return router.deps.inventory.countAvailable(Number(first["product_id"]));
}

function mask(deps: AdminRouter["deps"], ciphertext: unknown): string {
  if (typeof ciphertext !== "string" || ciphertext === "") return "";
  try {
    return deps.crypto.mask(deps.crypto.decrypt(ciphertext));
  } catch {
    return "";
  }
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
