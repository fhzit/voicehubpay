import assert from "node:assert/strict";
import { test } from "node:test";
import { createSqliteDatabase } from "../../../packages/db/src/index.js";
import { ensureAdminSchema } from "../src/admin/index.js";
import { createHarness } from "./admin-harness.js";

test("admin guard: anonymous /admin redirects to the login page with the target path", async () => {
  const h = await createHarness();
  const res = await h.app.inject({ method: "GET", url: "/admin" });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, "/login?redirect=%2Fadmin");

  const other = await h.app.inject({ method: "GET", url: "/admin/orders?page=2" });
  assert.equal(other.statusCode, 302);
  assert.equal(other.headers.location, "/login?redirect=%2Fadmin%2Forders");
  await h.app.close();
});

test("admin guard: anonymous POST is redirected before any CSRF or write happens", async () => {
  const h = await createHarness();
  const form = h.form({ _csrf: "", name: "不应创建", price: "1.00" });
  const res = await h.app.inject({ method: "POST", url: "/admin/products/save", ...form });
  assert.equal(res.statusCode, 302);
  assert.match(String(res.headers.location), /^\/login\?redirect=/);
  const count = Number((await h.db.query("SELECT COUNT(*) AS n FROM products")).rows[0]?.["n"]);
  assert.equal(count, 0);
  await h.app.close();
});

test("admin guard: logged-in non-admin gets 403 on every /admin page", async () => {
  const h = await createHarness();
  const userId = await h.seedUser({ username: "plain", role: "user" });
  await h.login(userId);
  const form = h.form({ _csrf: "test-csrf-token" });
  for (const url of ["/admin", "/admin/products", "/admin/orders", "/admin/settings/general", "/admin/system/database"]) {
    const res = await h.app.inject({ method: "GET", url, headers: form.headers });
    assert.equal(res.statusCode, 403, `${url} must be 403`);
  }
  await h.app.close();
});

test("admin guard: disabled admin account loses access (session user re-validated)", async () => {
  const h = await createHarness();
  const userId = await h.seedUser({ username: "sleeper", role: "admin", status: "disabled" });
  await h.login(userId);
  const res = await h.app.inject({ method: "GET", url: "/admin" });
  assert.equal(res.statusCode, 302);
  await h.app.close();
});

test("admin guard: POST without a matching _csrf token is rejected and nothing is written", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  await h.login(adminId);

  const missing = await h.app.inject({ method: "POST", url: "/admin/products/save", ...h.form({ name: "无 token", price: "9.90" }) });
  assert.equal(missing.statusCode, 303);
  assert.equal(missing.headers.location, "/login");

  const wrong = await h.app.inject({ method: "POST", url: "/admin/products/save", ...h.form({ _csrf: "forged", name: "伪造 token", price: "9.90" }) });
  assert.equal(wrong.statusCode, 303);
  assert.equal(wrong.headers.location, "/login");

  const count = Number((await h.db.query("SELECT COUNT(*) AS n FROM products")).rows[0]?.["n"]);
  assert.equal(count, 0);
  await h.app.close();
});

test("admin guard: admin dashboard renders inside the admin layout", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  const cookie = await h.login(adminId);
  const res = await h.app.inject({ method: "GET", url: "/admin", headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /text\/html/);
  assert.match(res.body, /仪表盘/);
  assert.match(res.body, /admin-shell/);
  assert.match(res.body, /总营收/);
  await h.app.close();
});

test("schema: ensureAdminSchema creates categories/audit_logs and is idempotent", async () => {
  const db = createSqliteDatabase(":memory:");
  await ensureAdminSchema(db);
  await ensureAdminSchema(db);
  const tables = (await db.query("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((row) => String(row["name"]));
  assert.ok(tables.includes("categories"));
  assert.ok(tables.includes("audit_logs"));
  await db.close();
});
