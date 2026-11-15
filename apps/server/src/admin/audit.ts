/**
 * `/admin/audit` — operation log listing (port of Admin\AuditController).
 */

import type { AdminRouter } from "./router.js";
import { formInt, formString, pagination } from "./router.js";
import type { Row } from "./types.js";

const PER_PAGE = 30;

export function registerAuditRoutes(router: AdminRouter): void {
  router.get("/admin/audit", async (context) => {
    const audit = router.deps.audit;
    if (audit === undefined) {
      return context.render("audit", {
        pageTitle: "操作日志",
        nav: "audit",
        logs: [],
        total: 0,
        page: 1,
        pages: 0,
        filters: {},
        actions: [],
      });
    }

    const { query } = context;
    const filters = {
      action: formString(query, "action"),
      object_type: formString(query, "object_type"),
      q: formString(query, "q"),
      from: formString(query, "from"),
      to: formString(query, "to"),
    };
    const requested = Math.max(1, formInt(query, "page", 1));
    const result = await audit.list(filters, requested, PER_PAGE);
    const { page, pages } = pagination(query, result.perPage, result.total);

    const logs: Row[] = result.items.map((log) => {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(String(log["metadata"] ?? "{}")) as unknown;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
      } catch {
        metadata = {};
      }
      return { ...log, metadata_parsed: metadata };
    });

    return context.render("audit", {
      pageTitle: "操作日志",
      nav: "audit",
      logs,
      total: result.total,
      page,
      pages,
      filters,
      actions: await audit.distinctActions(),
    });
  });
}
