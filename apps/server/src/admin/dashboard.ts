/**
 * `/admin` dashboard: KPI cards, revenue trend, product ranking, inventory
 * overview and VoiceHub delivery health (port of DashboardController).
 *
 * KPI aggregation needs SQL that the repositories do not expose, so it runs
 * through the optional read-only `db` handle. Without it the page still
 * renders, with zeroed KPIs.
 */

import type { AdminContext, AdminRouter } from "./router.js";
import { formString } from "./router.js";
import type { Row } from "./types.js";

const RANGES = new Set(["today", "week", "month", "all", "custom"]);
const CHANNELS = new Set(["all", "shop", "afdian"]);
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

interface Bounds {
  from: string;
  to: string;
  granularity: "hour" | "day";
  buckets: Array<{ key: string; label: string }>;
}

export function registerDashboardRoutes(router: AdminRouter): void {
  router.get("/admin", async (context) => {
    const range = pick(formString(context.query, "range", "today"), RANGES, "today");
    const channel = pick(formString(context.query, "channel", "all"), CHANNELS, "all");
    const customFrom = formString(context.query, "from");
    const customTo = formString(context.query, "to");

    const bounds = rangeBounds(range, customFrom, customTo, (router.deps.clock?.now() ?? Math.floor(Date.now() / 1000)) * 1000);
    const model = await buildDashboard(router, bounds, channel);

    return context.render("dashboard", {
      pageTitle: "仪表盘",
      nav: "dashboard",
      range,
      channel,
      custom_from: customFrom,
      custom_to: customTo,
      ...model,
    });
  });
}

function pick(value: string, allowed: Set<string>, fallback: string): string {
  return allowed.has(value) ? value : fallback;
}

/** Start/end instants (UTC ISO) plus trend buckets for the selected range. */
export function rangeBounds(range: string, customFrom: string, customTo: string, nowMs = Date.now()): Bounds {
  const shanghaiDay = new Date(nowMs + SHANGHAI_OFFSET_MS);
  const year = shanghaiDay.getUTCFullYear();
  const month = shanghaiDay.getUTCMonth();
  const day = shanghaiDay.getUTCDate();

  if (range === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(customFrom) && /^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
    const from = Date.parse(`${customFrom}T00:00:00+08:00`);
    const to = Date.parse(`${customTo}T23:59:59+08:00`);
    if (Number.isFinite(from) && Number.isFinite(to) && from <= to) {
      return { from: iso(from), to: iso(to), granularity: "day", buckets: dayBuckets(from, to, "MM-DD") };
    }
  }

  if (range === "all") {
    // Whole history: totals span every paid order, the trend window stays at the
    // last 30 days so the chart remains readable.
    return {
      from: "1970-01-01T00:00:00+00:00",
      to: iso(nowMs),
      granularity: "day",
      buckets: dayBuckets(nowMs - 30 * 24 * 3600 * 1000, nowMs, "MM-DD"),
    };
  }

  if (range === "week" || range === "month") {
    const startLocal = range === "week"
      ? Date.UTC(year, month, day - 6)
      : Date.UTC(year, month, 1);
    const from = startLocal - SHANGHAI_OFFSET_MS;
    const to = nowMs;
    return { from: iso(from), to: iso(to), granularity: "day", buckets: dayBuckets(from, to, "MM-DD") };
  }

  const from = Date.UTC(year, month, day) - SHANGHAI_OFFSET_MS;
  const to = from + 24 * 3600 * 1000 - 1000;
  return { from: iso(from), to: iso(to), granularity: "hour", buckets: hourBuckets() };
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function hourBuckets(): Array<{ key: string; label: string }> {
  return Array.from({ length: 24 }, (_, hour) => ({
    key: String(hour).padStart(2, "0"),
    label: `${String(hour).padStart(2, "0")}:00`,
  }));
}

function dayBuckets(fromMs: number, toMs: number, pattern: string): Array<{ key: string; label: string }> {
  const buckets: Array<{ key: string; label: string }> = [];
  const start = new Date(fromMs + SHANGHAI_OFFSET_MS);
  const end = new Date(toMs + SHANGHAI_OFFSET_MS);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  for (let guard = 0; cursor.getTime() <= last && guard < 400; guard += 1) {
    const key = cursor.toISOString().slice(0, 10);
    const mm = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(cursor.getUTCDate()).padStart(2, "0");
    buckets.push({ key, label: pattern === "MM-DD" ? `${mm}-${dd}` : key });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return buckets;
}

interface DashboardModel {
  kpis: { current: Record<string, number>; deltas: Record<string, number> };
  trends: { income: Array<{ label: string; shop: number; afdian: number; total: number }>; source_pct: { shop: number; afdian: number } };
  ranking: Row[];
  inventory: { available: number; reserved: number; sold: number; disabled: number };
  vh_sources: Array<{ key: string; success: number; failed: number; total: number }>;
  recent_failures: Row[];
  afdian_stats: { today_revenue: number; today_orders: number; last_webhook: string | null; last_poll: string | null; voicehub: Record<string, number> };
}

async function buildDashboard(router: AdminRouter, bounds: Bounds, channel: string): Promise<DashboardModel> {
  const deps = router.deps;
  const config = deps.config;
  const shopFee = clampPercent(config.get("SHOP_FEE_PERCENT", "3"), 3);
  const afdianFee = clampPercent(config.get("AFDIAN_FEE_PERCENT", "6"), 6);

  const shopRows = await query(deps, "SELECT amount_paid_cents, created_at FROM orders WHERE payment_status = 'paid' AND created_at >= ? AND created_at <= ?", [bounds.from, bounds.to]);
  const afdianRows = await query(deps, "SELECT amount_cents, created_at FROM afdian_orders WHERE status = 'paid' AND created_at >= ? AND created_at <= ?", [bounds.from, bounds.to]);

  let shopRevenue = 0;
  let shopOrders = 0;
  for (const row of shopRows) {
    shopRevenue += num(row["amount_paid_cents"]);
    shopOrders += 1;
  }
  let afdianRevenue = 0;
  let afdianOrders = 0;
  for (const row of afdianRows) {
    afdianRevenue += num(row["amount_cents"]);
    afdianOrders += 1;
  }

  const soldRow = await query(deps, "SELECT COALESCE(SUM(oi.quantity), 0) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.payment_status = 'paid' AND o.created_at >= ? AND o.created_at <= ?", [bounds.from, bounds.to]);
  const manualRow = await query(deps, "SELECT COUNT(*) AS n FROM orders WHERE fulfillment_status = 'manual_completed' AND created_at >= ? AND created_at <= ?", [bounds.from, bounds.to]);
  const abnormalRow = await query(deps, "SELECT COUNT(*) AS n FROM orders WHERE payment_status = 'paid' AND fulfillment_status IN ('failed','manual_review') AND created_at >= ? AND created_at <= ?", [bounds.from, bounds.to]);

  const deliveryStats = await deps.voicehubDeliveries.stats().catch((): Record<string, number> => ({}));
  const voicehubSuccess = num(deliveryStats["success"]);
  const voicehubFailed = num(deliveryStats["failed"]);
  const deliveryTotal = voicehubSuccess + voicehubFailed;
  const successRate = deliveryTotal > 0 ? Math.round((voicehubSuccess / deliveryTotal) * 1000) / 10 : 100;

  const totalRevenue = (channel === "afdian" ? 0 : shopRevenue) + (channel === "shop" ? 0 : afdianRevenue);
  const paidOrders = (channel === "afdian" ? 0 : shopOrders) + (channel === "shop" ? 0 : afdianOrders);
  const actualRevenue = Math.round((channel === "afdian" ? 0 : shopRevenue * (1 - shopFee / 100)) + (channel === "shop" ? 0 : afdianRevenue * (1 - afdianFee / 100)));

  const income = bounds.buckets.map((bucket) => ({ label: bucket.label, shop: 0, afdian: 0, total: 0 }));
  const index = new Map(bounds.buckets.map((bucket, i) => [bucket.key, i]));
  for (const row of shopRows) {
    const slot = bucketIndex(index, String(row["created_at"] ?? ""), bounds.granularity);
    if (slot !== null) {
      const entry = income[slot]!;
      entry.shop += num(row["amount_paid_cents"]);
      entry.total += num(row["amount_paid_cents"]);
    }
  }
  for (const row of afdianRows) {
    const slot = bucketIndex(index, String(row["created_at"] ?? ""), bounds.granularity);
    if (slot !== null) {
      const entry = income[slot]!;
      entry.afdian += num(row["amount_cents"]);
      entry.total += num(row["amount_cents"]);
    }
  }

  const chartedShop = channel === "afdian" ? 0 : income.reduce((sum, entry) => sum + entry.shop, 0);
  const chartedAfdian = channel === "shop" ? 0 : income.reduce((sum, entry) => sum + entry.afdian, 0);
  const chartedTotal = chartedShop + chartedAfdian;
  const sourcePct = {
    shop: chartedTotal > 0 ? Math.round((chartedShop / chartedTotal) * 1000) / 10 : 0,
    afdian: chartedTotal > 0 ? Math.round((chartedAfdian / chartedTotal) * 1000) / 10 : 0,
  };

  const ranking = await productRanking(deps, bounds);
  const inventory = await deps.inventory.totalStats().catch(() => ({ available: 0, reserved: 0, sold: 0, disabled: 0 }));
  const vhSources = await voicehubSources(deps);
  const recentFailures = await deps.voicehubDeliveries.recentFailures(8).catch((): Row[] => []);

  // Same-length previous window: drives the ▲/▼ deltas on the KPI cards.
  const fromMs = Date.parse(bounds.from);
  const toMs = Date.parse(bounds.to);
  const span = Math.max(0, toMs - fromMs);
  const previousShop = await query(deps, "SELECT COALESCE(SUM(amount_paid_cents), 0) AS sum FROM orders WHERE payment_status = 'paid' AND created_at >= ? AND created_at < ?", [iso(fromMs - span), bounds.from]);
  const previousAfdian = await query(deps, "SELECT COALESCE(SUM(amount_cents), 0) AS sum FROM afdian_orders WHERE status = 'paid' AND created_at >= ? AND created_at < ?", [iso(fromMs - span), bounds.from]);
  const previousSold = await query(deps, "SELECT COALESCE(SUM(oi.quantity), 0) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.payment_status = 'paid' AND o.created_at >= ? AND o.created_at < ?", [iso(fromMs - span), bounds.from]);
  const previous = {
    shop: num(previousShop[0]?.["sum"]),
    afdian: num(previousAfdian[0]?.["sum"]),
    sold: num(previousSold[0]?.["n"]),
  };
  const growth = (currentValue: number, previousValue: number): number =>
    previousValue > 0 ? Math.round(((currentValue - previousValue) / previousValue) * 1000) / 10 : 0;
  const previousTotal = (channel === "afdian" ? 0 : previous.shop) + (channel === "shop" ? 0 : previous.afdian);
  const previousActual = Math.round(
    (channel === "afdian" ? 0 : previous.shop * (1 - shopFee / 100)) + (channel === "shop" ? 0 : previous.afdian * (1 - afdianFee / 100)),
  );

  const afdianStats = {
    today_revenue: await deps.afdianOrders.sumToday().catch(() => 0),
    today_orders: await deps.afdianOrders.countToday().catch(() => 0),
    last_webhook: config.get("AFDIAN_LAST_WEBHOOK_AT", "") || null,
    last_poll: config.get("AFDIAN_LAST_POLL_AT", "") || null,
    voicehub: await deps.afdianOrders.stats().catch((): Record<string, number> => ({})),
  };

  const current: Record<string, number> = {
    total_revenue: totalRevenue,
    shop_revenue: channel === "afdian" ? 0 : shopRevenue,
    afdian_revenue: channel === "shop" ? 0 : afdianRevenue,
    avg_order_value: paidOrders > 0 ? Math.round(totalRevenue / paidOrders) : 0,
    paid_orders: paidOrders,
    shop_orders: shopOrders,
    afdian_orders: afdianOrders,
    sold_units: num(soldRow[0]?.["n"]),
    actual_revenue: actualRevenue,
    voicehub_success_rate: successRate,
    voicehub_success: voicehubSuccess,
    voicehub_failed: voicehubFailed,
    manual_completed: num(manualRow[0]?.["n"]),
    abnormal_orders: num(abnormalRow[0]?.["n"]),
  };

  const deltas: Record<string, number> = {
    total_revenue: growth(totalRevenue, previousTotal),
    shop_revenue: channel === "afdian" ? 0 : growth(shopRevenue, previous.shop),
    afdian_revenue: channel === "shop" ? 0 : growth(afdianRevenue, previous.afdian),
    sold_units: growth(num(soldRow[0]?.["n"]), previous.sold),
    actual_revenue: growth(actualRevenue, previousActual),
  };

  return {
    kpis: { current, deltas },
    trends: { income, source_pct: sourcePct },
    ranking,
    inventory,
    vh_sources: vhSources,
    recent_failures: recentFailures,
    afdian_stats: afdianStats,
  };
}

async function productRanking(deps: AdminRouter["deps"], bounds: Bounds): Promise<Row[]> {
  const rows = await query(
    deps,
    `SELECT p.name AS name, p.price_cents AS price_cents,
            COALESCE(SUM(oi.quantity), 0) AS sold_units,
            COALESCE(SUM(oi.quantity * oi.product_price_cents_snapshot), 0) AS revenue_cents,
            (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'available') AS stock_available
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE o.payment_status = 'paid' AND o.created_at >= ? AND o.created_at <= ?
     GROUP BY p.id, p.name, p.price_cents
     ORDER BY revenue_cents DESC
     LIMIT 8`,
    [bounds.from, bounds.to],
  );
  return rows;
}

async function voicehubSources(deps: AdminRouter["deps"]): Promise<Array<{ key: string; success: number; failed: number; total: number }>> {
  const rows = await query(
    deps,
    `SELECT code_source, status, COUNT(*) AS n FROM voicehub_deliveries GROUP BY code_source, status`,
  );
  const table = new Map<string, { key: string; success: number; failed: number; total: number }>();
  for (const row of rows) {
    const key = String(row["code_source"] ?? "");
    const entry = table.get(key) ?? { key, success: 0, failed: 0, total: 0 };
    const count = num(row["n"]);
    if (String(row["status"] ?? "") === "success") entry.success += count;
    if (String(row["status"] ?? "") === "failed") entry.failed += count;
    entry.total += count;
    table.set(key, entry);
  }
  return [...table.values()];
}

async function query(deps: AdminRouter["deps"], sql: string, parameters: readonly unknown[] = []): Promise<Row[]> {
  if (deps.db === undefined) return [];
  try {
    return (await deps.db.query(sql, parameters)).rows;
  } catch {
    return [];
  }
}

function bucketIndex(index: Map<string, number>, createdAt: string, granularity: "hour" | "day"): number | null {
  if (createdAt === "") return null;
  const parsed = Date.parse(createdAt);
  if (Number.isNaN(parsed)) return null;
  const local = new Date(parsed + SHANGHAI_OFFSET_MS);
  const key = granularity === "hour"
    ? String(local.getUTCHours()).padStart(2, "0")
    : local.toISOString().slice(0, 10);
  return index.get(key) ?? null;
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampPercent(raw: string, fallback: number): number {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

export type { AdminContext };
