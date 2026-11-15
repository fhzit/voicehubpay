/**
 * Server-side view renderer (EJS) with layouts, partials and PHP-parity helpers.
 *
 * Mirrors `src/Http/View.php` from the PHP implementation:
 *   - `render(view, data, layout)` renders a template inside a layout
 *   - partials are plain EJS includes resolved from the template root
 *   - helpers e()/money()/moneySymbol()/datetime() match the PHP semantics
 *
 * Templates live in `apps/server/templates/<name>.ejs`; layouts in
 * `apps/server/templates/layouts/<layout>.ejs`. A layout receives the rendered
 * body as `content` plus every key passed to `renderPage`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import type { FastifyReply } from "fastify";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the template directory. */
export const TEMPLATE_ROOT = path.resolve(HERE, "..", "templates");

/** Absolute path to the static asset directory served at /assets. */
export const ASSET_ROOT = path.resolve(HERE, "..", "..", "..", "public");

/** HTML-escape a value the same way PHP's `View::e()` does. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Format integer cents as a plain decimal string (PHP `View::money`). */
export function money(cents: number): string {
  const value = Number.isFinite(cents) ? cents / 100 : 0;
  return value.toFixed(2);
}

/** Format integer cents with a leading currency symbol (PHP `View::moneySymbol`). */
export function moneySymbol(cents: number): string {
  return `¥${money(cents)}`;
}

/** Format an ISO timestamp in the site timezone (default Asia/Shanghai). */
export function datetime(iso?: string | null, timezone = "Asia/Shanghai"): string {
  if (!iso) return "-";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return String(iso);
  try {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(parsed);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
  } catch {
    return String(iso);
  }
}

/** Build a versioned /assets URL so CSS/JS updates are cache-busted. */
const ASSET_VERSION = "10";
export function asset(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, "");
  return `/assets/${clean}${clean.includes("?") ? "&" : "?"}v=${ASSET_VERSION}`;
}

/** Helpers injected into every template. */
export const viewHelpers = {
  e: escapeHtml,
  money,
  moneySymbol,
  datetime,
  asset,
  badge,
} as const;


/** Synchronous status badge (EJS partials are async, unusable inside forEach). */
const BADGE_MAP: Record<string, Record<string, [string, string]>> = {
  payment: { paid: ["green", "已支付"], unpaid: ["amber", "未支付"], pending: ["blue", "待确认"], failed: ["red", "失败"], cancelled: ["gray", "已取消"] },
  fulfillment: { success: ["green", "已发货"], manual_completed: ["purple", "人工完成"], partial: ["orange", "部分完成"], processing: ["blue", "发货中"], pending: ["amber", "待发货"], failed: ["red", "发货失败"], manual_review: ["orange", "待人工处理"] },
  order: { completed: ["green", "已完成"], pending_payment: ["amber", "待支付"], cancelled: ["gray", "已取消"], manual_review: ["orange", "待人工处理"] },
  delivery: { success: ["green", "成功"], failed: ["red", "失败"], processing: ["blue", "处理中"], pending: ["amber", "待处理"], not_required: ["gray", "无需推送"] },
  voicehub: { success: ["green", "成功"], failed: ["red", "失败"], processing: ["blue", "处理中"], pending: ["amber", "待处理"], not_required: ["gray", "—"], already_success: ["green", "已成功"] },
  inventory: { available: ["green", "可售"], reserved: ["blue", "已占用"], sold: ["gray", "已售"], disabled: ["red", "停用"] },
  user: { active: ["green", "正常"], disabled: ["red", "已禁用"] },
  afdian: { paid: ["green", "已支付"], unpaid: ["amber", "未支付"], pending: ["blue", "处理中"], failed: ["red", "失败"], success: ["green", "已发货"] },
  status: { active: ["green", "上架"], draft: ["gray", "草稿"], disabled: ["red", "下架"], success: ["green", "成功"], failed: ["red", "失败"] },
};

export function badge(kind: string, status?: unknown): string {
  const value = status === undefined || status === null ? "" : String(status);
  const entry = (BADGE_MAP[kind] && BADGE_MAP[kind][value]) || ["gray", value === "" ? "—" : value];
  return `<span class="badge badge-${entry[0]}">${escapeHtml(entry[1])}</span>`;
}

export interface RenderOptions {
  /** Layout name under templates/layouts (without extension). */
  layout?: string | null;
  /** HTTP status for `renderPage`. */
  status?: number;
  /** Extra headers for `renderPage`. */
  headers?: Record<string, string>;
}

/**
 * Render a view (optionally inside a layout) to an HTML string.
 */
export async function renderView(
  view: string,
  data: Record<string, unknown> = {},
  options: RenderOptions = {},
): Promise<string> {
  const viewFile = path.join(TEMPLATE_ROOT, `${view}.ejs`);
  const body = await ejs.renderFile(viewFile, { ...viewHelpers, ...data }, { async: true });
  if (!options.layout) return body;
  const layoutFile = path.join(TEMPLATE_ROOT, "layouts", `${options.layout}.ejs`);
  return ejs.renderFile(
    layoutFile,
    { ...viewHelpers, ...data, content: body },
    { async: true },
  );
}

/**
 * Render a view and send it as the reply body with `text/html` content type.
 * Returns the reply so callers can `return renderPage(...)`.
 */
export async function renderPage(
  reply: FastifyReply,
  view: string,
  data: Record<string, unknown> = {},
  options: RenderOptions = {},
): Promise<FastifyReply> {
  const html = await renderView(view, data, options);
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) reply.header(key, value);
  }
  return reply
    .code(options.status ?? 200)
    .header("content-type", "text/html; charset=utf-8")
    .send(html);
}

/**
 * Render an error page using the shared `errors/*` templates.
 */
export async function renderError(
  reply: FastifyReply,
  status: 403 | 404 | 500 | 503,
  data: Record<string, unknown> = {},
): Promise<FastifyReply> {
  const view = status === 503 ? "errors/maintenance" : `errors/${status}`;
  return renderPage(reply, view, { pageTitle: `${status}`, ...data }, {
    status,
    layout: status === 503 ? "shop" : "shop",
  });
}
