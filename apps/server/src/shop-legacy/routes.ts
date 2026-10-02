import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Csrf } from "../auth-legacy/csrf.js";
import { SESSION_COOKIE, SessionManager } from "../auth-legacy/session-manager.js";
import type { LegacySessionContext } from "../auth-legacy/types.js";
import { Sg65Client } from "./sg65-client.js";
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
      deps.sg65Post ?? defaultPost,
    ),
    orders: deps.orders,
    transactions: deps.transactions,
    crypto: deps.crypto,
    fulfillment: deps.fulfillment,
    mailer: deps.mailer,
    users: deps.users,
  });
}

async function defaultPost(path: string, body: string): Promise<{ status: number; text: string }> {
  const response = await fetch(`${Sg65Client.BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, text: await response.text() };
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
      return reply.code(404).send("Not Found");
    }
    await ctx.sessions.persist(context);
    return reply.code(200).send({
      template: "checkout/checkout",
      data: {
        order,
        enabled_types: sg65EnabledTypes(deps.config),
        default_type: defaultPayType(deps.config),
        payment_enabled: deps.config.bool("SG65_ENABLED", false),
        method: deps.config.get("SG65_DEFAULT_METHOD", "jump"),
        csrf_token: Csrf.token(context.data),
      },
    });
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

    try {
      const result = await paymentService(deps).createPayment(order, payType, request.ip);
      if (deps.audit) {
        await deps.audit.log(Number(user["id"]), "payment.create", "order", String(order["order_no"]), { type: payType }, request.ip, request.headers["user-agent"] ?? "");
      }
      // jump method: redirect to pay_info.
      return ctx.redirectTo(reply, result.pay_info);
    } catch (error) {
      const message = error instanceof ShopError || error instanceof PaymentError ? error.message : "订单创建失败，请稍后重试。";
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
      return reply.code(404).send("Not Found");
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
    await ctx.sessions.persist(context);
    return reply.code(200).send({
      template: "checkout/pay-return",
      data: { order, order_no: orderNo },
    });
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

function sg65EnabledTypes(config: { get(key: string, fallback?: string): string }): string[] {
  const raw = config.get("SG65_ENABLED_TYPES", "alipay,wxpay,qqpay");
  const allowed = ["alipay", "wxpay", "qqpay"];
  return allowed.filter((type) => raw.split(",").map((p) => p.trim()).includes(type));
}

function defaultPayType(config: { get(key: string, fallback?: string): string }): string {
  const t = config.get("SG65_DEFAULT_PAYMENT_TYPE", "alipay");
  return ["alipay", "wxpay", "qqpay"].includes(t) ? t : "alipay";
}
