/**
 * `/admin/payments` — SG65 payment ledger (port of Admin\PaymentController).
 */

import type { AdminRouter } from "./router.js";
import { formInt, formString, pagination } from "./router.js";

const PER_PAGE = 20;

export function registerPaymentRoutes(router: AdminRouter): void {
  router.get("/admin/payments", async (context) => {
    const { query } = context;
    const payType = formString(query, "pay_type");
    const status = formString(query, "status");
    const q = formString(query, "q");
    const requested = Math.max(1, formInt(query, "page", 1));
    const result = await router.deps.payments.listAdmin(payType, status, q, requested, PER_PAGE);
    const { page, pages } = pagination(query, result.perPage, result.total);
    return context.render("payments/index", {
      pageTitle: "支付流水",
      nav: "payments",
      transactions: result.items,
      total: result.total,
      page,
      pages,
      pay_type: payType,
      status,
      q,
    });
  });
}
