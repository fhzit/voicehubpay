import type { FastifyInstance, FastifyRequest } from "fastify";
import { createProductRequestSchema, orderStatusResponseSchema, productIdParamsSchema, productListResponseSchema, productResponseSchema } from "../../../packages/contracts/src/commerce.js";
import { hashSessionToken } from "./auth.js";
import type { AuthDependencies } from "./auth.js";

export interface CommerceDependencies {
  auth: AuthDependencies;
  products: { listProducts(): Promise<Array<{ id: number; name: string; slug: string; description: string; priceCents: number; status: "draft" | "active" | "archived" }>>; getProduct(id: number): Promise<{ id: number; name: string; slug: string; description: string; priceCents: number; status: "draft" | "active" | "archived" } | null>; createProduct(input: { name: string; slug: string; description?: string; priceCents: number; status?: "draft" | "active" | "archived" }): Promise<number> };
  orders?: { getForUser(id: number, userId: string): Promise<unknown | null> };
  isAdmin?: (userId: string) => Promise<boolean>;
}

async function authenticated(request: FastifyRequest, dependencies: AuthDependencies) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vh_session="))?.slice("vh_session=".length);
  if (!cookie || !/^[A-Za-z0-9_-]{40,}$/.test(cookie)) return null;
  return dependencies.sessions.find(hashSessionToken(cookie));
}

export function configureCommerce(app: FastifyInstance, dependencies: CommerceDependencies): void {
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
  app.post("/api/orders", async (_request, reply) => reply.code(501).send({ error: "PURCHASING_NOT_IMPLEMENTED", message: "Purchasing is not implemented" }));
  app.get("/api/orders/:id", async (request, reply) => {
    const session = await authenticated(request, dependencies.auth);
    if (!session) return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Authentication required" });
    const params = productIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "BAD_REQUEST", message: "Invalid order ID" });
    if (!dependencies.orders) return reply.code(501).send({ error: "ORDER_STATUS_UNAVAILABLE", message: "Order status is not available" });
    const order = await dependencies.orders.getForUser(params.data.id, session.userId);
    return order ? reply.code(200).send(orderStatusResponseSchema.parse(order)) : reply.code(404).send({ error: "NOT_FOUND", message: "Order not found" });
  });
}
