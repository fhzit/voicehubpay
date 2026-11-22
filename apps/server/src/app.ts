import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { healthResponseSchema } from "../../../packages/contracts/src/index.js";
import { ASSET_ROOT } from "./render.js";
import { configureAuth, type AuthDependencies } from "./auth.js";
import { configureCommerce, type CommerceDependencies } from "./commerce.js";
import { configurePaymentRoutes, configureShopRoutes } from "./shop-legacy/routes.js";
import type { ShopLegacyDependencies } from "./shop-legacy/types.js";
import { configureBotQuery, type BotQueryDependencies } from "./bot-query.js";

const requestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

export function buildApp(options: {
  auth?: AuthDependencies;
  commerce?: CommerceDependencies;
  /** Legacy shop/payment pipeline (order create, SG65 pay/notify, status/reveal). */
  shop?: ShopLegacyDependencies;
  /** Token-guarded bot lookup API (order number / Afdian trade no / coupon). */
  botQuery?: BotQueryDependencies;
  secureCookies?: boolean;
} = {}): FastifyInstance {
  const app = Fastify({ logger: false, genReqId: (request) => {
    const supplied = request.headers["x-request-id"];
    return typeof supplied === "string" && requestIdPattern.test(supplied) ? supplied : randomUUID();
  } });

  // PHP-parity form posts (login, register, checkout, admin settings) all use
  // application/x-www-form-urlencoded. Fastify ships no such parser, and the
  // per-scope registrations left the shop routes without one — every
  // POST /orders/:no/pay answered 415 and the user never reached the cashier.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    const params = new URLSearchParams(String(body));
    const parsed: Record<string, string | string[]> = {};
    for (const [key, value] of params) {
      const existing = parsed[key];
      if (existing === undefined) parsed[key] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else parsed[key] = [existing, value];
    }
    done(null, parsed);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  // Breadcrumb for every unhandled route error (loggers are disabled in this
  // deployment, so a rendered 500 would otherwise leave no trace).
  app.addHook("onError", async (request, _reply, error) => {
    console.error(`[onError] ${request.method} ${request.url}`, error);
  });

  // Static assets (CSS/JS) served from the PHP-compatible public/assets tree.
  void app.register(fastifyStatic, {
    root: path.join(ASSET_ROOT, "assets"),
    prefix: "/assets/",
    decorateReply: false,
    cacheControl: true,
    maxAge: "1h",
  });

  app.setErrorHandler((error, request, reply) => {
    if (typeof error === "object" && error !== null && "validation" in error) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "Request validation failed", requestId: request.id });
    }
    request.log.error({ err: error }, "request failed");
    // Keep a stderr breadcrumb: the app runs with the Fastify logger disabled,
    // so without this a rendered 500 page leaves no trace in container logs.
    console.error(`[500] ${request.method} ${request.url}`, error);
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: "An unexpected error occurred", requestId: request.id });
  });

  app.get("/health", async (_request, reply) => reply.code(200).send(healthResponseSchema.parse({ status: "ok" })));

  if (options.auth) configureAuth(app, options.auth, options.secureCookies ?? false);
  else {
    app.post("/api/auth/login", async (_request, reply) => reply.code(501).send({ error: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured" }));
    app.get("/api/auth/me", async (_request, reply) => reply.code(501).send({ error: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured" }));
    app.post("/api/auth/rotate", async (_request, reply) => reply.code(501).send({ error: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured" }));
    app.post("/api/auth/logout", async (_request, reply) => reply.code(501).send({ error: "AUTH_NOT_CONFIGURED", message: "Authentication is not configured" }));
  }
  if (options.commerce) configureCommerce(app, options.commerce);
  else {
    app.get("/api/products", async (_request, reply) => reply.code(503).send({ error: "COMMERCE_NOT_CONFIGURED", message: "Product storage is not configured" }));
    app.get("/api/products/:id", async (_request, reply) => reply.code(503).send({ error: "COMMERCE_NOT_CONFIGURED", message: "Product storage is not configured" }));
    app.get("/api/orders/:id", async (_request, reply) => reply.code(501).send({ error: "PURCHASING_NOT_IMPLEMENTED", message: "Order status is not available" }));
    app.post("/api/orders", async (_request, reply) => reply.code(501).send({ error: "PURCHASING_NOT_IMPLEMENTED", message: "Purchasing is not implemented" }));
  }
  if (options.shop) {
    // Legacy-parity shop + SG65 payment routes. The notify endpoint must be
    // registered even when the gateway is disabled: PHP answers "disabled".
    configureShopRoutes(app, options.shop);
    configurePaymentRoutes(app, options.shop);
  }
  // Bot lookup is independent of the storefront: it must answer even when the
  // legacy shop is off (the bot still needs to resolve Afdian-only coupons).
  if (options.botQuery) configureBotQuery(app, options.botQuery);

  return app;
}
