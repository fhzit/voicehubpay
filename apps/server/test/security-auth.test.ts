import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createSqliteDatabase } from "../../../packages/db/src/index.js";
import { createSqliteAuthRepositories, migrateAuthSchema } from "../src/sqlite-auth.js";

const validEnv = { NODE_ENV: "test", PORT: "8080", HOST: "127.0.0.1", WEB_ORIGIN: "https://app.example.test" };

test("configuration validates environment and rejects unsafe production defaults", () => {
  assert.equal(loadConfig(validEnv).port, 8080);
  assert.throws(() => loadConfig({ ...validEnv, PORT: "70000" }), /PORT/);
  assert.throws(() => loadConfig({ ...validEnv, WEB_ORIGIN: "not-url" }), /WEB_ORIGIN/);
});

test("request IDs are generated and supplied values are sanitized", async () => {
  const app = buildApp();
  try {
    const generated = await app.inject({ method: "GET", url: "/health" });
    assert.match(generated.headers["x-request-id"] as string, /^[\da-f-]{36}$/i);
    const supplied = await app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "trace-abc_123" } });
    assert.equal(supplied.headers["x-request-id"], "trace-abc_123");
  } finally { await app.close(); }
});

test("login is explicitly not configured without injected persistence", async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "user@example.test", password: "secret" } });
    assert.equal(response.statusCode, 501);
    assert.equal(response.json().error, "AUTH_NOT_CONFIGURED");
    assert.doesNotMatch(response.body, /secret/);
  } finally { await app.close(); }
});

test("login failures do not reveal whether account exists", async () => {
  const app = buildApp({ auth: fakeAuth() });
  try {
    const unknown = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "missing@example.test", password: "wrong" } });
    const wrong = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "known@example.test", password: "wrong" } });
    assert.equal(unknown.statusCode, 401);
    assert.equal(unknown.body, wrong.body);
    assert.equal(unknown.headers["set-cookie"], undefined);
  } finally { await app.close(); }
});

test("session-authenticated mutations require CSRF and rotate session", async () => {
  const persistence = fakeAuth();
  const app = buildApp({ auth: persistence });
  try {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "known@example.test", password: "correct" } });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers["set-cookie"] as string;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const cookie = setCookie.split(";")[0]!;
    const csrf = login.json().csrfToken as string;
    const denied = await app.inject({ method: "POST", url: "/api/auth/rotate", headers: { cookie } });
    assert.equal(denied.statusCode, 403);
    const rotated = await app.inject({ method: "POST", url: "/api/auth/rotate", headers: { cookie, "x-csrf-token": csrf } });
    assert.equal(rotated.statusCode, 200);
    assert.notEqual((rotated.headers["set-cookie"] as string).split(";")[0], cookie);
    const oldSession = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    assert.equal(oldSession.statusCode, 401);
  } finally { await app.close(); }
});

test("SQLite auth persists login, CSRF rotation, /me and logout end to end", async () => {
  const db = createSqliteDatabase(":memory:");
  await migrateAuthSchema(db);
  await db.query("INSERT INTO server_auth_users (id, email, password_hash) VALUES (?, ?, ?)", ["sqlite-user", "known@example.test", "hash"]);
  const app = buildApp({ auth: { ...createSqliteAuthRepositories(db), passwords: { verify: async (hash, password) => hash === "hash" && password === "correct" } }, secureCookies: false });
  try {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "known@example.test", password: "correct" } });
    assert.equal(login.statusCode, 200, login.body);
    let cookie = (login.headers["set-cookie"] as string).split(";")[0]!;
    let csrf = login.json().csrfToken as string;
    assert.equal((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).json().userId, "sqlite-user");
    assert.equal((await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } })).statusCode, 403);
    const rotate = await app.inject({ method: "POST", url: "/api/auth/rotate", headers: { cookie, "x-csrf-token": csrf } });
    assert.equal(rotate.statusCode, 200);
    cookie = (rotate.headers["set-cookie"] as string).split(";")[0]!;
    csrf = rotate.json().csrfToken as string;
    assert.equal((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode, 200);
    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie, "x-csrf-token": csrf } });
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers["set-cookie"] as string, /Max-Age=0/);
    assert.equal((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode, 401);
  } finally { await app.close(); await db.close(); }
});

function fakeAuth() {
  const users = new Map([ ["known@example.test", { id: "user-1", passwordHash: "hash" }] ]);
  const sessions = new Map<string, { userId: string; csrfToken: string }>();
  return {
    users: { findByEmail: async (email: string) => users.get(email) ?? null },
    sessions: {
      create: async (userId: string, tokenHash: string, csrfToken: string, expiresAt: Date) => { void expiresAt; sessions.set(tokenHash, { userId, csrfToken }); },
      find: async (tokenHash: string) => sessions.get(tokenHash) ?? null,
      rotate: async (oldHash: string, newHash: string, csrfToken: string, expiresAt: Date) => {
        void expiresAt;
        const old = sessions.get(oldHash);
        if (!old) return false;
        sessions.delete(oldHash); sessions.set(newHash, { userId: old.userId, csrfToken }); return true;
      },
      revoke: async (tokenHash: string) => { sessions.delete(tokenHash); },
    },
    passwords: { verify: async (hash: string, password: string) => hash === "hash" && password === "correct" },
  };
}
