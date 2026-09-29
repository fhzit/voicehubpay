import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { healthResponseSchema, moneyCentsSchema, paymentStatusSchema } from "../../../packages/contracts/src/index.js";

test("health contract accepts only the healthy response shape", () => {
  assert.deepEqual(healthResponseSchema.parse({ status: "ok" }), { status: "ok" });
  assert.equal(healthResponseSchema.safeParse({ status: "ready" }).success, false);
});

test("shared contracts preserve integer cents and allowed payment statuses", () => {
  assert.equal(moneyCentsSchema.safeParse(1200).success, true);
  assert.equal(moneyCentsSchema.safeParse(12.5).success, false);
  assert.deepEqual(paymentStatusSchema.options, ["unpaid", "pending", "paid", "failed"]);
});

test("GET /health returns the shared health response contract", async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  } finally {
    await app.close();
  }
});

test("unknown routes return 404", async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: "GET", url: "/missing" });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});
