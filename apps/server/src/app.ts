import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { healthResponseSchema } from "../../../packages/contracts/src/index.js";
import { configureAuth, type AuthDependencies } from "./auth.js";
import { configureCommerce, type CommerceDependencies } from "./commerce.js";
import { configurePaymentRoutes, configureShopRoutes } from "./shop-legacy/routes.js";
import type { ShopLegacyDependencies } from "./shop-legacy/types.js";

const requestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

export function buildApp(options: {
  auth?: AuthDependencies;
  commerce?: CommerceDependencies;
  /** Legacy shop/payment pipeline (order create, SG65 pay/notify, status/reveal). */
  shop?: ShopLegacyDependencies;
  secureCookies?: boolean;
} = {}): FastifyInstance {
  const app = Fastify({ logger: false, genReqId: (request) => {
    const supplied = request.headers["x-request-id"];
    return typeof supplied === "string" && requestIdPattern.test(supplied) ? supplied : randomUUID();
  } });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (typeof error === "object" && error !== null && "validation" in error) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "Request validation failed", requestId: request.id });
    }
    request.log.error({ err: error }, "request failed");
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

  return app;
}