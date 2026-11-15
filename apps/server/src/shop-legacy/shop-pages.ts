/**
 * Storefront page routes (PHP HomeController / ProductController / OrderController::show).
 *
 * These render real HTML through ../render.js instead of the old envelope JSON.
 * Data comes from the legacy repositories (`ProductRepository`,
 * `CategoryRepository` in packages/db) plus the ShopLegacyDependencies ports,
 * so the TS pages stay semantically identical to the PHP controllers.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "../../../../packages/db/src/index.js";
import { CategoryRepository, ProductRepository } from "../../../../packages/db/src/legacy/index.js";
import { Csrf } from "../auth-legacy/csrf.js";
import type { LegacySessionContext } from "../auth-legacy/types.js";
import type { SessionManager } from "../auth-legacy/session-manager.js";
import { renderError, renderPage } from "../render.js";
import { buildSite } from "../site.js";
import type { Row, ShopLegacyDependencies } from "./types.js";

/** Session helpers provided by configureShopRoutes (see buildCtx). */
export interface ShopPageContext {
  start(request: FastifyRequest, reply: FastifyReply): Promise<LegacySessionContext>;
  currentUser(context: LegacySessionContext): Promise<Row | null>;
  requireLogin(request: FastifyRequest, reply: FastifyReply, context: LegacySessionContext): Promise<Row | null>;
  sessions: SessionManager;
}

const queryParam = (request: FastifyRequest, key: string, fallback = ""): string => {
  const value = (request.query as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : fallback;
};

const queryInt = (request: FastifyRequest, key: string, fallback: number): number => {
  const parsed = Number.parseInt(queryParam(request, key, ""), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

/** PHP ProductRepository sort keys → the values supported by listPublic(). */
function repositorySort(sort: string): string {
  if (sort === "price_asc") return "price";
  if (sort === "newest") return "newest";
  return "";
}

export function configureShopPageRoutes(app: FastifyInstance, deps: ShopLegacyDependencies, ctx: ShopPageContext): void {
  const site = buildSite(deps.config);
  // The ports only guarantee query() through `db`; the concrete handle is a
  // full Database in every wiring (sqlite.ts / tests), so the repositories can
  // be reused directly instead of duplicating their SQL.
  const db = deps.db as unknown as Database;
  const products = new ProductRepository(db);
  const categories = new CategoryRepository(db);

  const flashOf = async (context: LegacySessionContext) => {
    const flash = ctx.sessions.takeFlash(context);
    await ctx.sessions.persist(context);
    return flash;
  };

  const notFound = async (reply: FastifyReply, user: Row | null, nav = "") =>
    renderError(reply, 404, { site, user, nav });

  // -- GET / : storefront home (HomeController::index) --------------------------
  app.get("/", async (request, reply) => {
    const context = await ctx.start(request, reply);
    const user = await ctx.currentUser(context);
    const showHot = deps.config.get("HOT_SERVICES_ENABLED", "1") === "1";
    const hot = showHot ? await products.listHot(8) : [];
    return renderPage(
      reply,
      "shop/home",
      { hot, showHot, user, site, flash: await flashOf(context), csrf: Csrf.token(context.data), nav: "home" },
      { layout: "shop" },
    );
  });

  // -- GET /products : catalog listing (ProductController::index) ---------------
  app.get("/products", async (request, reply) => {
    const context = await ctx.start(request, reply);
    const user = await ctx.currentUser(context);
    const categoryId = queryInt(request, "category", 0) || null;
    const q = queryParam(request, "q", "");
    const sort = queryParam(request, "sort", "recommend") || "recommend";
    const page = Math.max(1, queryInt(request, "page", 1));
    const result = await products.listPublic({ category_id: categoryId ?? undefined, q, sort: repositorySort(sort) }, page, 12);
    let categoryRows: Row[] = [];
    try {
      categoryRows = await categories.listActive();
    } catch {
      // Categories are optional in minimal deployments/tests; the filter simply
      // shows "全部分类" rather than failing the page.
      categoryRows = [];
    }
    return renderPage(
      reply,
      "shop/products",
      {
        categories: categoryRows,
        products: result.items,
        total: result.total,
        page: result.page,
        pages: Math.ceil(result.total / Math.max(1, result.perPage)),
        filters: { category_id: categoryId, q, sort },
        user,
        site,
        flash: await flashOf(context),
        csrf: Csrf.token(context.data),
        nav: "products",
      },
      { layout: "shop" },
    );
  });

  // -- GET /product/{slug} : product detail (ProductController::show) -----------
  app.get("/product/:slug", async (request, reply) => {
    const context = await ctx.start(request, reply);
    const user = await ctx.currentUser(context);
    const slug = (request.params as { slug?: string }).slug ?? "";
    const product = slug === "" ? null : await products.findBySlug(slug);
    // Drafts and disabled products are indistinguishable from missing ones.
    if (product === null || product["status"] !== "active") {
      await flashOf(context);
      return notFound(reply, user, "products");
    }
    product["stock_available"] = await deps.inventory.countAvailable(Number(product["id"]));
    return renderPage(
      reply,
      "shop/product-detail",
      { product, user, site, flash: await flashOf(context), csrf: Csrf.token(context.data), nav: "products" },
      { layout: "shop" },
    );
  });

  // -- GET /orders/{orderNo} : order detail (OrderController::show) -------------
  app.get("/orders/:orderNo", async (request, reply) => {
    const context = await ctx.start(request, reply);
    const user = await ctx.requireLogin(request, reply, context);
    if (user === null) return reply;
    const orderNo = (request.params as { orderNo?: string }).orderNo ?? "";
    const order = await deps.orders.orderWithItems(orderNo);
    if (order === null || Number(order["user_id"]) !== Number(user["id"])) {
      await flashOf(context);
      return notFound(reply, user);
    }
    const payments = await deps.transactions.listForOrder(Number(order["id"]));
    const units = order.units.map((unit) => {
      const cipher = unit["delivery_code_ciphertext"];
      return {
        unit,
        masked: cipher === null || cipher === undefined ? "" : deps.crypto.mask(deps.crypto.decrypt(String(cipher))),
        voicehub_status: unit["voicehub_status"],
      };
    });
    const unitStats = await deps.orders.countUnitsByStatus(Number(order["id"]));
    return renderPage(
      reply,
      "account/order-detail",
      {
        order,
        units,
        payments,
        unit_stats: unitStats,
        user,
        site,
        flash: await flashOf(context),
        csrf: Csrf.token(context.data),
        nav: "orders",
        pageTitle: String(order["order_no"] ?? ""),
      },
      { layout: "account" },
    );
  });
}
