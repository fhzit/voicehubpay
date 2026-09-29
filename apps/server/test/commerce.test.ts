import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { hashSessionToken } from "../src/auth.js";
const token = "a".repeat(43), csrf = "b".repeat(43);
const product = { id: 1, name: "Visible", slug: "visible", description: "", priceCents: 900, status: "active" as const };
const hidden = { ...product, id: 2, name: "Draft", slug: "draft", status: "draft" as const };
function fixture(userId = "customer", admin = false) {
 const created: unknown[] = [];
 const commerce = { auth: { users: { findByEmail: async () => null }, sessions: { create: async () => {}, find: async (hash: string) => hash === hashSessionToken(token) ? { userId, csrfToken: csrf } : null, rotate: async () => false, revoke: async () => {} }, passwords: { verify: async () => false } }, products: { listProducts: async () => [product, hidden], getProduct: async (id: number) => id === 1 ? product : id === 2 ? hidden : null, createProduct: async (input: unknown) => { created.push(input); return 1; } }, isAdmin: async () => admin };
 return { app: buildApp({ commerce }), created };
}
test("product reads expose active products only", async () => { const { app } = fixture(); try { const response = await app.inject({ method: "GET", url: "/api/products" }); assert.equal(response.statusCode, 200); assert.deepEqual(response.json().products.map((p: { id: number }) => p.id), [1]); assert.equal((await app.inject({ method: "GET", url: "/api/products/2" })).statusCode, 404); } finally { await app.close(); } });
test("admin product creation requires authentication, CSRF and admin role", async () => { const { app, created } = fixture(); try { const payload = { name: "New", slug: "new", priceCents: 500 }; assert.equal((await app.inject({ method: "POST", url: "/api/products", payload })).statusCode, 401); const headers = { cookie: `vh_session=${token}` }; assert.equal((await app.inject({ method: "POST", url: "/api/products", headers, payload })).statusCode, 403); assert.equal((await app.inject({ method: "POST", url: "/api/products", headers: { ...headers, "x-csrf-token": csrf }, payload })).statusCode, 403); assert.equal(created.length, 0); } finally { await app.close(); } });
test("product mutation validates its request after access controls", async () => { const { app, created } = fixture("admin", true); try { const response = await app.inject({ method: "POST", url: "/api/products", headers: { cookie: `vh_session=${token}`, "x-csrf-token": csrf }, payload: { name: "Bad", slug: "bad", priceCents: 1, total: 999 } }); assert.equal(response.statusCode, 400); assert.equal(created.length, 0); } finally { await app.close(); } });
test("purchase endpoint fails closed and does not create payment or order", async () => { const { app } = fixture(); try { const response = await app.inject({ method: "POST", url: "/api/orders", payload: { productId: 1, quantity: 2, totalCents: 1 } }); assert.equal(response.statusCode, 501); assert.equal(response.json().error, "PURCHASING_NOT_IMPLEMENTED"); } finally { await app.close(); } });
