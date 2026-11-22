import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Csrf } from "../auth-legacy/csrf.js";
import { SESSION_COOKIE, SessionManager } from "../auth-legacy/session-manager.js";
import type { LegacySessionContext } from "../auth-legacy/types.js";
import { renderError, renderPage } from "../render.js";
import { buildSite } from "../site.js";
import { configureErrorPages } from "../error-pages.js";
import { Sg65Client, sg65HttpPost } from "./sg65-client.js";
import { EpayV2Client } from "./epayv2-client.js";
import { EpayV1Client } from "./epayv1-client.js";
import { configureShopPageRoutes } from "./shop-pages.js";
import { PaymentService, ShopService, PaymentError, ShopError } from "./shop-service.js";
import type { Row, ShopLegacyDependencies } from "./types.js";

/**
 * Faithful ports of VoiceHubPay\Controllers\OrderController,
 * PaymentController and ApiController as Fastify route configurators.
 *
 * Exports (wired later by app integration):
 *   - configureShopRoutes(app, deps)
 *       POST /orders, GET /checkout/{orderNo}, POST /orders/{orderNo}/pay
 *   - configurePaymentRoutes(app, deps)
 *       GET /payments/sg65/notify, GET /payments/sg65/return,
 *       GET /api/orders/{orderNo}/status,
 *       POST /api/cards/{unitId}/reveal, POST /api/orders/{orderNo}/reveal-all
 *
 * Session/flash/CSRF semantics are reused from auth-legacy (SessionManager +
 * Csrf); redirects are 302 like the PHP Response::redirect baseline. Flash
 * messages ride the session plus x-flash-* headers (auth-legacy convention).
 */

type MutableDeps = ShopLegacyDependencies & {
  users: { findById(id: number): Promise<Row | null> };
  secureCookies?: boolean;
};

interface Ctx {
  sessions: SessionManager;
  start(request: FastifyRequest, reply: FastifyReply): Promise<LegacySessionContext>;
  currentUser(context: LegacySessionContext): Promise<Row | null>;
  redirectTo(reply: FastifyReply, url: string): FastifyReply;
  redirectWithFlash(reply: FastifyReply, context: LegacySessionContext, url: string, message: string, type?: "success" | "error"): FastifyReply;
  requireLogin(request: FastifyRequest, reply: FastifyReply, context: LegacySessionContext): Promise<Row | null>;
  requireCsrf(request: FastifyRequest, reply: FastifyReply, context: LegacySessionContext): Promise<boolean>;
  requireCsrfToken(request: FastifyRequest, context: LegacySessionContext): Promise<boolean>;
}

function buildCtx(deps: MutableDeps): Ctx {
  const sessions = new SessionManager(deps.sessions as never, deps.clock ?? { now: () => Math.floor(Date.now() / 1000) });
  const secure = deps.secureCookies ?? false;
  const cookie = (id: string): string => `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  const readSessionCookie = (request: FastifyRequest): string | null => {
    const header = request.headers.cookie;
    if (!header) return null;
    for (const part of header.split(";")) {
      const trimmed = part.trim();
      if (trimmed.startsWith(`${SESSION_COOKIE}=`)) return trimmed.slice(SESSION_COOKIE.length + 1) || null;
    }
    return null;
  };

  const currentUser = async (context: LegacySessionContext): Promise<Row | null> => {
    const id = context.data["user_id"];
    if (id === null || id === undefined) return null;
    const user = await deps.users.findById(Number(id));
    if (user === null || String(user["status"] ?? "") !== "active") return null;
    return user;
  };

  const redirectTo = (reply: FastifyReply, url: string): FastifyReply => reply.code(302).header("location", url).send();

  const redirectWithFlash = (reply: FastifyReply, context: LegacySessionContext, url: string, message: string, type: "success" | "error" = "success"): FastifyReply => {
    sessions.flash(context, message, type);
    reply.header("x-flash-message", Buffer.from(message, "utf8").toString("base64"));
    reply.header("x-flash-type", type);
    return redirectTo(reply, url);
  };

  const requireLogin = async (request: FastifyRequest, reply: FastifyReply, context: LegacySessionContext): Promise<Row | null> => {
    const user = await currentUser(context);
    if (user === null) {
      await sessions.persist(context);
      redirectTo(reply, `/login?redirect=${encodeURIComponent(request.url.split("?")[0] ?? "/")}`);
      return null;
    }
    return user;
  };

  const tokenOf = (request: FastifyRequest): string | null => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const token = typeof body["_csrf"] === "string" ? body["_csrf"] : (request.headers["x-csrf-token"] ?? null);
    return typeof token === "string" ? token : null;
  };

  const requireCsrfToken = async (request: FastifyRequest, context: LegacySessionContext): Promise<boolean> =>
    Csrf.verify(context.data, tokenOf(request));

  return {
    sessions,
    start: async (request, reply) => {
      const context = await sessions.start(readSessionCookie(request));
      if (context.isNew) reply.header("set-cookie", cookie(context.id));
      request.legacySession = context;
      return context;
    },
    currentUser,
    redirectTo,
    redirectWithFlash,
    requireLogin,
    requireCsrf: async (request, reply, context) => {
      if (!(await requireCsrfToken(request, context))) {
        await sessions.persist(context);
        redirectWithFlash(reply, context, "/login", "会话已过期，请重新操作。", "error");
        return false;
      }
      return true;
    },
    requireCsrfToken,
  };
}

const owns = (order: Row, user: Row | null): boolean => user !== null && Number(order["user_id"]) === Number(user["id"]);

const formString = (value: unknown): string => (typeof value === "string" ? value : "");
const formInt = (value: unknown): number => {
  const parsed = Number.parseInt(typeof value === "string" ? value : String(value ?? ""), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};
const bodyOf = (request: FastifyRequest): Record<string, unknown> => (request.body ?? {}) as Record<string, unknown>;

function paymentService(deps: MutableDeps): PaymentService {
  return new PaymentService({
    config: deps.config,
    clock: deps.clock,
    sg65: new Sg65Client(
      deps.config,
      deps.clock ?? { now: () => Math.floor(Date.now() / 1000) },
      deps.sg65Post ?? sg65HttpPost,
    ),
    epayv2: new EpayV2Client(
      deps.config,
      deps.clock ?? { now: () => Math.floor(Date.now() / 1000) },
      deps.sg65Post ?? sg65HttpPost,
    ),
    epayv1: new EpayV1Client(deps.config),
    orders: deps.orders,
    transactions: deps.transactions,
    crypto: deps.crypto,
    fulfillment: deps.fulfillment,
    mailer: deps.mailer,
    users: deps.users,
  });
}


/** Redirect-style login guard for JSON API endpoints (PHP requireLogin redirect). */
async function apiLoginGuard(ctx: Ctx, request: FastifyRequest, reply: FastifyReply): Promise<LegacySessionContext | null> {
  const context = await ctx.start(request, reply);
  const user = await ctx.currentUser(context);
  if (user === null) {
    await ctx.sessions.persist(context);
    ctx.redirectTo(reply, `/login?redirect=${encodeURIComponent(request.url.split("?")[0] ?? "/")}`);
    return null;
  }
  return context;
}

// ----------------------------------------------------------------------------------
// Shop routes (OrderController port)
// ----------------------------------------------------------------------------------

export function configureShopRoutes(app: FastifyInstance, rawDeps: ShopLegacyDependencies): void {
  const deps = rawDeps as MutableDeps;
  const ctx = buildCtx(deps);
  const site = buildSite(deps.config);

  // Storefront pages (HTML) + shared 404/500 error pages. app.ts cannot be
  // touched, so the shop module installs the not-found/error handlers for the
  // storefront surface; /api/* and /health keep their JSON contracts.
  configureErrorPages(app, { config: deps.config });
  configureShopPageRoutes(app, deps, ctx);

  // -- POST /orders : create a shop order (session re-validated server-side) --
  app.post("/orders", async (request, reply) => {
    const context = await ctx.start(request, reply);
    const user = await ctx.requireLogin(request, reply, context);
    if (user === null) return reply;
    if (!(await ctx.requireCsrf(request, reply, context))) return reply;

    const body = bodyOf(request);
    const productId = formInt(body["product_id"]);
    const quantity = body["quantity"] === undefined ? 1 : formInt(body["quantity"]);
    const slug = formString(body["slug"]);
    const redirectUrl = `/product/${slug}`;

    const shop = new ShopService({
      config: deps.config,
      orders: deps.orders,
      products: deps.products,
      inventory: deps.inventory,
      transactions: deps.transactions,
      crypto: deps.crypto,
      db: deps.db,
      clock: deps.clock,
    });
    try {
      const order = await shop.createOrder(Number(user["id"]), productId, quantity);
      return ctx.redirectTo(reply, `/checkout/${order["order_no"]}`);
    } catch (error) {
      if (error instanceof ShopError) {
        return ctx.redirectWithFlash(reply, context, redirectUrl, error.message, "error");
      }
      if (error instanceof Error && error.message === "insufficient_stock") {
        return ctx.redirectWithFlash(reply, context, redirectUrl, "库存不足，请选择更少的数量或稍后再试。", "error");
      }
      return ctx.redirectWithFlash(reply, context, redirectUrl, "订单创建失败，请稍后重试。", "error");
    }
  });

  // -- GET /checkout/{orderNo} ------------------------------------------------
  app.get("/checkout/:orderNo", async (request, reply) => {
    const context = await ctx.start(request, reply);
    const user = await ctx.requireLogin(request, reply, context);
    if (user === null) return reply;
    const orderNo = (request.params as { orderNo?: string }).orderNo ?? "";
    const order = await deps.orders.orderWithItems(orderNo);
    if (order === null || !owns(order, user)) {
      return renderError(reply, 404, { site, user, nav: "account" });
    }
    const flash = ctx.sessions.takeFlash(context);
    await ctx.sessions.persist(context);
    const channels = payChannels(deps.config);
    const requestedChannel = typeof (request.query as Record<string, unknown>)?.["channel"] === "string" ? String((request.query as Record<string, unknown>)["channel"]) : "";
    const activeChannel = channels.find((entry) => entry.id === requestedChannel) ?? channels[0];
    return renderPage(
      reply,
      "checkout/checkout",
      {
        order,
        enabled_types: activeChannel?.types ?? [],
        default_type: activeChannel?.default_type ?? defaultPayType(deps.config),
        payment_enabled: channels.length > 0,
        channels,
        selected_channel: activeChannel?.id ?? "sg65",
        method: deps.config.get("SG65_DEFAULT_METHOD", "jump"),
        order_ttl: deps.config.int("ORDER_TTL_MINUTES", 30),
        user,
        site,
        flash,
        csrf: Csrf.token(context.data),
        nav: "account",
        pageTitle: "确认订单",
      },
      { layout: "shop" },
    );
  });

  // -- POST /orders/{orderNo}/pay : create a SG65 payment ------------------------
  app.post("/orders/:orderNo/pay", async (request, reply) => {
    const context = await ctx.start(request, reply);
    const user = await ctx.requireLogin(request, reply, context);
    if (user === null) return reply;
    if (!(await ctx.requireCsrf(request, reply, context))) return reply;
    const orderNo = (request.params as { orderNo?: string }).orderNo ?? "";
    const order = await deps.orders.findByOrderNo(orderNo);
    if (order === null || !owns(order, user)) {
      return reply.code(404).send({ ok: false, error: "订单不存在。" });
    }
    const payType = formString(bodyOf(request)["pay_type"]) || "alipay";
    const requestedChannel = formString(bodyOf(request)["channel"]);
    const channel: "sg65" | "epayv2" | "epayv1" = requestedChannel === "epayv2" || requestedChannel === "epayv1"
      ? requestedChannel
      : "sg65";

    try {
      const result = await paymentService(deps).createPayment(order, payType, request.ip, channel);
      if (deps.audit) {
        await deps.audit.log(Number(user["id"]), "payment.create", "order", String(order["order_no"]), { type: payType }, request.ip, request.headers["user-agent"] ?? "");
      }
      // jump method: redirect to pay_info.
      return ctx.redirectTo(reply, result.pay_info);
    } catch (error) {
      console.error(`[pay] ${orderNo} createPayment failed`, error);
      const message = error instanceof ShopError || error instanceof PaymentError
        ? error.message
        : error instanceof Error && /支付网关连接失败/.test(error.message)
          ? "支付网关暂时无法连接，请稍后重试。"
          : "订单创建失败，请稍后重试。";
      return ctx.redirectWithFlash(reply, context, `/checkout/${orderNo}`, message, "error");
    }
  });
}

// ----------------------------------------------------------------------------------
// Payment callback + JSON API routes (PaymentController + ApiController ports)
// ----------------------------------------------------------------------------------

export function configurePaymentRoutes(app: FastifyInstance, rawDeps: ShopLegacyDependencies): void {
  const deps = rawDeps as MutableDeps;
  const ctx = buildCtx(deps);
  const site = buildSite(deps.config);

  // -- GET /payments/sg65/notify : SG65 sends notify as GET ----------------------
  app.get("/payments/sg65/notify", async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    try {
      const result = await paymentService(deps).handleNotify(query);
      if (result === "success") {
        return reply.code(200).header("content-type", "text/plain; charset=utf-8").send("success");
      }
      // Log but return a non-committal response (never an exception page).
      console.error(`[sg65 notify] rejected: ${result}`);
      return reply.code(200).header("content-type", "text/plain; charset=utf-8").send(result === "verify_failed" ? "verify_failed" : "error");
    } catch (error) {
      console.error("[sg65 notify]", error instanceof Error ? error.message : error);
      return reply.code(500).header("content-type", "text/plain; charset=utf-8").send("error");
    }
  });

  // -- 易支付V2 异步通知（GET/POST 均可能）----------------------------------------
  const epayNotify = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const query = { ...(request.query as Record<string, unknown> ?? {}), ...(request.body as Record<string, unknown> ?? {}) };
    try {
      const result = await paymentService(deps).handleEpayNotify(query);
      if (result === "success") return reply.code(200).header("content-type", "text/plain; charset=utf-8").send("success");
      console.error(`[epayv2 notify] rejected: ${result}`);
      return reply.code(200).header("content-type", "text/plain; charset=utf-8").send("fail");
    } catch (error) {
      console.error("[epayv2 notify]", error instanceof Error ? error.message : error);
      return reply.code(500).header("content-type", "text/plain; charset=utf-8").send("error");
    }
  };
  app.get("/payments/epayv2/notify", epayNotify);
  app.post("/payments/epayv2/notify", epayNotify);

  // -- 易支付V1 异步通知（MD5，GET/POST 均可能；纯文本 success 应答）---------------
  const epayV1Notify = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const query = { ...(request.query as Record<string, unknown> ?? {}), ...(request.body as Record<string, unknown> ?? {}) };
    try {
      const result = await paymentService(deps).handleEpayV1Notify(query);
      if (result === "success") return reply.code(200).header("content-type", "text/plain; charset=utf-8").send("success");
      console.error(`[epayv1 notify] rejected: ${result}`);
      return reply.code(200).header("content-type", "text/plain; charset=utf-8").send("fail");
    } catch (error) {
      console.error("[epayv1 notify]", error instanceof Error ? error.message : error);
      return reply.code(500).header("content-type", "text/plain; charset=utf-8").send("error");
    }
  };
  app.get("/payments/epayv1/notify", epayV1Notify);
  app.post("/payments/epayv1/notify", epayV1Notify);

  // -- 易支付V2 同步跳转（同样不直接确认支付）--------------------------------------
  const epayReturn = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const context = await ctx.start(request, reply);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const orderNo = typeof query["out_trade_no"] === "string" ? query["out_trade_no"] : "";
    const order = orderNo !== "" ? await deps.orders.findByOrderNo(orderNo) : null;
    const user = await ctx.currentUser(context);
    if (order === null || user === null || Number(order["user_id"]) !== Number(user["id"])) {
      return renderError(reply, 404, { site, user, nav: "account" });
    }
    const flash = ctx.sessions.takeFlash(context);
    await ctx.sessions.persist(context);
    return renderPage(
      reply,
      "checkout/pay-return",
      { order, order_no: orderNo, user, site, flash, csrf: Csrf.token(context.data), nav: "account", pageTitle: "支付结果" },
      { layout: "shop" },
    );
  };
  app.get("/payments/epayv2/return", epayReturn);
  app.get("/payments/epayv1/return", epayReturn);

  // -- GET /payments/sg65/return : NEVER confirms payment directly -----------------
  app.get("/payments/sg65/return", async (request, reply) => {
    const context = await ctx.start(request, reply);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const orderNo = typeof query["out_trade_no"] === "string" ? query["out_trade_no"] : "";
    const order = orderNo !== "" ? await deps.orders.findByOrderNo(orderNo) : null;
    const user = await ctx.currentUser(context);
    // The gateway return URL is public, but order status/details are not.
    // Treat missing, guessed and another user's order number identically.
    if (order === null || user === null || Number(order["user_id"]) !== Number(user["id"])) {
      return renderError(reply, 404, { site, user, nav: "account" });
    }
    // If a logged-in user owns this order and local state is still unpaid,
    // attempt a server-side active query (best-effort, non-blocking).
    if (String(order["payment_status"] ?? "") !== "paid") {
      try {
        await paymentService(deps).queryAndBackfill(order);
      } catch (error) {
        console.error("[sg65 return query]", error instanceof Error ? error.message : error);
      }
    }
    const flash = ctx.sessions.takeFlash(context);
    await ctx.sessions.persist(context);
    return renderPage(
      reply,
      "checkout/pay-return",
      { order, order_no: orderNo, user, site, flash, csrf: Csrf.token(context.data), nav: "account", pageTitle: "支付结果" },
      { layout: "shop" },
    );
  });

  // -- GET /api/orders/{orderNo}/status : polling for the pay-return page ----------
  app.get("/api/orders/:orderNo/status", async (request, reply) => {
    const context = await apiLoginGuard(ctx, request, reply);
    if (context === null) return reply;
    const user = (await ctx.currentUser(context))!;
    const orderNo = (request.params as { orderNo?: string }).orderNo ?? "";
    const order = await deps.orders.orderWithItems(orderNo);
    if (order === null || !owns(order, user)) {
      return reply.code(404).send({ ok: false, error: "not found" });
    }
    const stats = await deps.orders.countUnitsByStatus(Number(order["id"]));
    const total = Number(order.items[0]?.["quantity"] ?? order.units.length);
    return reply.code(200).send({
      ok: true,
      payment_status: order["payment_status"],
      order_status: order["order_status"],
      fulfillment_status: order["fulfillment_status"],
      paid_at: order["paid_at"],
      unit_stats: stats,
      unit_total: total,
    });
  });

  // -- POST /api/cards/{unitId}/reveal : reveal a single unit's full code -----------
  app.post("/api/cards/:unitId/reveal", async (request, reply) => {
    const context = await apiLoginGuard(ctx, request, reply);
    if (context === null) return reply;
    if (!(await ctx.requireCsrfToken(request, context))) {
      return reply.code(303).header("location", "/login").send();
    }
    const user = (await ctx.currentUser(context))!;
    const unitId = Number.parseInt((request.params as { unitId?: string }).unitId ?? "0", 10) || 0;
    const unit = await deps.orders.findUnit(unitId);
    if (unit === null) {
      return reply.code(404).send({ ok: false, error: "not found" });
    }
    const order = await deps.orders.findById(Number(unit["order_id"]));
    // Ownership is verified through orders.user_id — never returns other users' cards.
    if (order === null || Number(order["user_id"]) !== Number(user["id"])) {
      return reply.code(403).send({ ok: false, error: "forbidden" });
    }
    if (String(order["payment_status"] ?? "") !== "paid") {
      return reply.code(403).send({ ok: false, error: "订单未支付" });
    }
    const cipher = unit["delivery_code_ciphertext"];
    if (cipher === null || cipher === undefined) {
      return reply.code(202).send({ ok: false, error: "尚未发放" });
    }
    return reply.code(200).send({
      ok: true,
      code: deps.crypto.decrypt(String(cipher)),
      status: unit["status"],
      voicehub_status: unit["voicehub_status"],
    });
  });

  // -- POST /api/orders/{orderNo}/reveal-all : reveal all codes of a paid order ------
  app.post("/api/orders/:orderNo/reveal-all", async (request, reply) => {
    const context = await apiLoginGuard(ctx, request, reply);
    if (context === null) return reply;
    if (!(await ctx.requireCsrfToken(request, context))) {
      return reply.code(303).header("location", "/login").send();
    }
    const user = (await ctx.currentUser(context))!;
    const orderNo = (request.params as { orderNo?: string }).orderNo ?? "";
    const order = await deps.orders.orderWithItems(orderNo);
    if (order === null || !owns(order, user)) {
      return reply.code(403).send({ ok: false, error: "forbidden" });
    }
    if (String(order["payment_status"] ?? "") !== "paid") {
      return reply.code(403).send({ ok: false, error: "订单未支付" });
    }
    const codes: string[] = [];
    for (const unit of order.units) {
      const cipher = unit["delivery_code_ciphertext"];
      if (cipher !== null && cipher !== undefined) {
        codes.push(deps.crypto.decrypt(String(cipher)));
      }
    }
    return reply.code(200).send({ ok: true, codes });
  });
}

// ----------------------------------------------------------------------------------
// Shared helpers
// ----------------------------------------------------------------------------------

/** 收银台可选渠道（仅返回已启用、且至少有一种支付方式的渠道）。 */
export interface PayChannelOption {
  id: "sg65" | "epayv2" | "epayv1";
  label: string;
  types: string[];
  default_type: string;
}

export function payChannels(config: { get(key: string, fallback?: string): string; bool(key: string, fallback: boolean): boolean }): PayChannelOption[] {
  const out: PayChannelOption[] = [];
  if (config.bool("SG65_ENABLED", false)) {
    const types = sg65EnabledTypes(config);
    if (types.length > 0) out.push({ id: "sg65", label: "易付通（SG65）", types, default_type: defaultPayType(config) });
  }
  if (config.bool("EPAY_V2_ENABLED", false)) {
    const raw = config.get("EPAY_V2_ENABLED_TYPES", "alipay,wxpay");
    const allowed = ["alipay", "wxpay", "qqpay"];
    const types = allowed.filter((type) => raw.split(",").map((p) => p.trim()).includes(type));
    const preferred = config.get("EPAY_V2_DEFAULT_TYPE", "alipay");
    if (types.length > 0) {
      out.push({ id: "epayv2", label: "易支付V2", types, default_type: types.includes(preferred) ? preferred : types[0]! });
    }
  }
  if (config.bool("EPAY_V1_ENABLED", false)) {
    const raw = config.get("EPAY_V1_ENABLED_TYPES", "alipay,wxpay");
    const allowed = ["alipay", "wxpay", "qqpay"];
    const types = allowed.filter((type) => raw.split(",").map((p) => p.trim()).includes(type));
    const preferred = config.get("EPAY_V1_DEFAULT_TYPE", "alipay");
    if (types.length > 0) {
      out.push({ id: "epayv1", label: "易支付V1（页面支付）", types, default_type: types.includes(preferred) ? preferred : types[0]! });
    }
  }
  return out;
}

function sg65EnabledTypes(config: { get(key: string, fallback?: string): string }): string[] {
  const raw = config.get("SG65_ENABLED_TYPES", "alipay,wxpay,qqpay");
  const allowed = ["alipay", "wxpay", "qqpay"];
  return allowed.filter((type) => raw.split(",").map((p) => p.trim()).includes(type));
}

function defaultPayType(config: { get(key: string, fallback?: string): string }): string {
  const t = config.get("SG65_DEFAULT_PAYMENT_TYPE", "alipay");
  return ["alipay", "wxpay", "qqpay"].includes(t) ? t : "alipay";
}
