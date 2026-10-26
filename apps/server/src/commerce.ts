import type { FastifyInstance, FastifyRequest } from "fastify";
import { createOrderRequestSchema, createProductRequestSchema, orderStatusResponseSchema, productIdParamsSchema, productListResponseSchema, productResponseSchema } from "../../../packages/contracts/src/commerce.js";
import { hashSessionToken } from "./auth.js";
import type { AuthDependencies } from "./auth.js";
import { ShopService, ShopError } from "./shop-legacy/shop-service.js";
import type { ShopLegacyDependencies } from "./shop-legacy/types.js";
import { PaymentService, PaymentError } from "./shop-legacy/shop-service.js";
import { Sg65Client } from "./shop-legacy/sg65-client.js";
import { configureAfdianWebhook, type AfdianWebhookDependencies } from "./afdian-webhook.js";

export interface CommerceDependencies {
  auth: AuthDependencies;
  products: { listProducts(): Promise<Array<{ id: number; name: string; slug: string; description: string; priceCents: number; status: "draft" | "active" | "archived" }>>; getProduct(id: number): Promise<{ id: number; name: string; slug: string; description: string; priceCents: number; status: "draft" | "active" | "archived" } | null>; createProduct(input: { name: string; slug: string; description?: string; priceCents: number; status?: "draft" | "active" | "archived" }): Promise<number> };
  orders?: { getForUser(id: number | string, userId: string): Promise<unknown | null> };
  isAdmin?: (userId: string) => Promise<boolean>;
  shop?: ShopLegacyDependencies;
  afdianWebhook?: AfdianWebhookDependencies;
}

async function authenticated(request: FastifyRequest, dependencies: AuthDependencies) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vh_session="))?.slice("vh_session=".length);
  if (!cookie || !/^[A-Za-z0-9_-]{40,}$/.test(cookie)) return null;
  return dependencies.sessions.find(hashSessionToken(cookie));
}

export function configureCommerce(app: FastifyInstance, dependencies: CommerceDependencies): void {
  if (dependencies.afdianWebhook) configureAfdianWebhook(app, dependencies.afdianWebhook);
  app.get("/api/products", async (_request, reply) => {
    const products = (await dependencies.products.listProducts()).filter((product) => product.status === "active").map((product) => productResponseSchema.parse(product));
    return reply.code(200).send(productListResponseSchema.parse({ products }));
  });
  app.get("/api/products/:id", async (request, reply) => {
    const params = productIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "BAD_REQUEST", message: "Invalid product ID" });
    const product = await dependencies.products.getProduct(params.data.id);
    if (!product || product.status !== "active") return reply.code(404).send({ error: "NOT_FOUND", message: "Product not found" });
    return reply.code(200).send(productResponseSchema.parse(product));
  });
  app.post("/api/products", async (request, reply) => {
    const session = await authenticated(request, dependencies.auth);
    if (!session) return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Authentication required" });
    const csrf = request.headers["x-csrf-token"];
    if (typeof csrf !== "string" || csrf.length !== session.csrfToken.length || !Buffer.from(csrf).equals(Buffer.from(session.csrfToken))) return reply.code(403).send({ error: "CSRF_INVALID", message: "CSRF validation failed" });
    if (!dependencies.isAdmin || !(await dependencies.isAdmin(session.userId))) return reply.code(403).send({ error: "FORBIDDEN", message: "Administrator role required" });
    const parsed = createProductRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", message: "Invalid product request" });
    const id = await dependencies.products.createProduct(parsed.data);
    const product = await dependencies.products.getProduct(id);
    if (!product) throw new Error("Created product not visible");
    return reply.code(201).send(productResponseSchema.parse(product));
  });
  app.post("/api/orders", async (request, reply) => {
    const session = await authenticated(request, dependencies.auth);
    if (!session) return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Authentication required" });
    const csrf = request.headers["x-csrf-token"];
    if (typeof csrf !== "string" || csrf.length !== session.csrfToken.length || !Buffer.from(csrf).equals(Buffer.from(session.csrfToken))) return reply.code(403).send({ error: "CSRF_INVALID", message: "CSRF validation failed" });
    const parsed = createOrderRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", message: "Invalid order request" });
    if (!dependencies.shop) return reply.code(503).send({ error: "PURCHASING_NOT_CONFIGURED", message: "Purchasing is not configured" });
    try {
      const shop = new ShopService({ config: dependencies.shop.config, orders: dependencies.shop.orders, products: dependencies.shop.products, inventory: dependencies.shop.inventory, transactions: dependencies.shop.transactions, crypto: dependencies.shop.crypto, db: dependencies.shop.db, clock: dependencies.shop.clock });
      const order = await shop.createOrder(Number(session.userId), parsed.data.productId, parsed.data.quantity);
      return reply.code(201).send({ orderNo: order["order_no"], amountDueCents: order["amount_due_cents"], paymentStatus: order["payment_status"] });
    } catch (error) {
      if (error instanceof ShopError || (error instanceof Error && error.message === "insufficient_stock")) return reply.code(400).send({ error: "ORDER_REJECTED", message: error.message });
      throw error;
    }
  });
  app.post("/api/orders/:orderNo/pay", async (request, reply) => {
    const session = await authenticated(request, dependencies.auth);
    if (!session) return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Authentication required" });
    const csrf = request.headers["x-csrf-token"];
    if (typeof csrf !== "string" || csrf.length !== session.csrfToken.length || !Buffer.from(csrf).equals(Buffer.from(session.csrfToken))) return reply.code(403).send({ error: "CSRF_INVALID", message: "CSRF validation failed" });
    const raw = request.params as { orderNo?: unknown };
    if (typeof raw.orderNo !== "string" || raw.orderNo.length === 0 || raw.orderNo.length > 128) return reply.code(400).send({ error: "BAD_REQUEST", message: "Invalid order number" });
    const body = request.body as { payType?: unknown } | undefined;
    if (!body || typeof body.payType !== "string" || !["alipay", "wxpay", "qqpay"].includes(body.payType)) return reply.code(400).send({ error: "BAD_REQUEST", message: "Invalid payment type" });
    const deps = dependencies.shop;
    if (!deps) return reply.code(503).send({ error: "PURCHASING_NOT_CONFIGURED", message: "Purchasing is not configured" });
    const order = await deps.orders.findByOrderNo(raw.orderNo);
    if (!order || Number(order["user_id"]) !== Number(session.userId)) return reply.code(404).send({ error: "NOT_FOUND", message: "Order not found" });
    try {
      const clock = deps.clock ?? { now: () => Math.floor(Date.now() / 1000) };
      const payment = new PaymentService({ config: deps.config, clock, sg65: new Sg65Client(deps.config, clock, deps.sg65Post ?? (async () => { throw new Error("SG65 transport unavailable"); })), orders: deps.orders, transactions: deps.transactions, crypto: deps.crypto, fulfillment: deps.fulfillment, mailer: deps.mailer, users: deps.users });
      const result = await payment.createPayment(order, body.payType, request.ip);
      return reply.code(200).send({ payInfo: result.pay_info, tradeNo: result.trade_no });
    } catch (error) {
      if (error instanceof PaymentError) return reply.code(400).send({ error: "PAYMENT_REJECTED", message: error.message });
      throw error;
    }
  });
  app.get("/api/orders/:id", async (request, reply) => {
    const session = await authenticated(request, dependencies.auth);
    if (!session) return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Authentication required" });
    const rawId = (request.params as { id?: unknown }).id;
    if (typeof rawId !== "string" || rawId.length === 0 || rawId.length > 128) return reply.code(400).send({ error: "BAD_REQUEST", message: "Invalid order ID" });
    const order = dependencies.orders ? await dependencies.orders.getForUser(rawId, session.userId) : null;
    return order ? reply.code(200).send(orderStatusResponseSchema.parse(order)) : reply.code(404).send({ error: "NOT_FOUND", message: "Order not found" });
  });
}
