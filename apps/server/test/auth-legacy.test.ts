import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { createSqliteDatabase, type Database } from "../../../packages/db/src/index.js";
import {
  configureAccountRoutes,
  configureAuthRoutes,
  createSqliteLegacyAuthDependencies,
  MapConfig,
  PasswordHasher,
} from "../src/auth-legacy/index.js";
import type { Clock, LegacyAuthDependencies, SocialProfile } from "../src/auth-legacy/index.js";

/** Fixed clock for deterministic throttle/lockout and admin-timeout behaviour. */
class FixedClock implements Clock {
  constructor(public seconds = 1_700_000_000) {}
  now(): number {
    return this.seconds;
  }
  advance(seconds: number): void {
    this.seconds += seconds;
  }
}

interface SocialCall {
  provider: string;
  code: string;
}

function stubSocialProvider() {
  const profiles = new Map<string, SocialProfile>();
  const calls: SocialCall[] = [];
  let failExchange = false;
  return {
    profiles,
    calls,
    failExchange,
    setProfile(provider: string, code: string, profile: SocialProfile): void {
      profiles.set(`${provider}:${code}`, profile);
    },
    async authorizeUrl(provider: string, redirectAfter: string) {
      void redirectAfter;
      return { url: `https://aggregate.example.test/connect?provider=${provider}&state=stub-state`, state: "stub-state" };
    },
    async exchangeCode(provider: string, code: string): Promise<SocialProfile> {
      if (failExchange) throw new Error("aggregate down");
      calls.push({ provider, code });
      const profile = profiles.get(`${provider}:${code}`);
      if (!profile) throw new Error("no profile");
      return profile;
    },
  };
}

/** Schema mirroring database/migrations/sqlite (001,002,006,007,008,012,014). */
async function migrateLegacySchema(db: Database): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    display_name VARCHAR(128) NOT NULL DEFAULT '',
    avatar_url VARCHAR(512) NOT NULL DEFAULT '',
    email VARCHAR(255) NOT NULL DEFAULT '',
    role VARCHAR(16) NOT NULL DEFAULT 'user',
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS social_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider VARCHAR(16) NOT NULL,
    social_uid VARCHAR(128) NOT NULL,
    nickname VARCHAR(128) NOT NULL DEFAULT '',
    avatar_url VARCHAR(512) NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (provider, social_uid))`);
  await db.query(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no VARCHAR(64) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'shop',
    amount_due_cents INTEGER NOT NULL DEFAULT 0,
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
    order_status VARCHAR(24) NOT NULL DEFAULT 'active',
    payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid',
    fulfillment_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    payment_gateway VARCHAR(16) NOT NULL DEFAULT '',
    payment_confirmation_source VARCHAR(16) NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NULL,
    paid_at TEXT NULL,
    fulfilled_at TEXT NULL,
    cancelled_at TEXT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name_snapshot VARCHAR(128) NOT NULL,
    product_price_cents_snapshot INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    delivery_mode_snapshot VARCHAR(32) NOT NULL DEFAULT 'card',
    voicehub_code_source_snapshot VARCHAR(32) NOT NULL DEFAULT 'inventory',
    created_at TEXT NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS fulfillment_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    order_item_id INTEGER NOT NULL,
    unit_index INTEGER NOT NULL DEFAULT 1,
    unit_no VARCHAR(96) NOT NULL,
    inventory_card_id INTEGER NULL,
    delivery_code_ciphertext TEXT NULL,
    delivery_code_hash VARCHAR(128) NULL,
    voicehub_code_ciphertext TEXT NULL,
    voicehub_code_hash VARCHAR(128) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    voicehub_status VARCHAR(24) NOT NULL DEFAULT 'not_required',
    voicehub_attempts INTEGER NOT NULL DEFAULT 0,
    voicehub_last_error TEXT NULL,
    manual_note TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    fulfilled_at TEXT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NULL,
    action VARCHAR(64) NOT NULL,
    object_type VARCHAR(32) NOT NULL DEFAULT '',
    object_id VARCHAR(128) NOT NULL DEFAULT '',
    ip VARCHAR(64) NOT NULL DEFAULT '',
    user_agent VARCHAR(512) NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL)`);
}

async function buildHarness(options: { config?: MapConfig; clock?: FixedClock } = {}) {
  const db = createSqliteDatabase(":memory:");
  await migrateLegacySchema(db);
  const clock = options.clock ?? new FixedClock();
  const config = options.config ?? new MapConfig(new Map([["QQ_LOGIN_ENABLED", "1"], ["WX_LOGIN_ENABLED", "1"]]));
  const socialProvider = stubSocialProvider();
  const deps = await createSqliteLegacyAuthDependencies(db, {
    clock,
    config,
    socialProvider,
    secureCookies: false,
  });
  const app = Fastify({ logger: false });
  configureAuthRoutes(app, deps);
  configureAccountRoutes(app, deps);
  return { app, deps, clock, socialProvider, db };
}

/** Cookie-jar helper tracking the session cookie across requests. */
function jar() {
  let cookie: string | null = null;
  return {
    capture(headers: Record<string, unknown>): void {
      const set = headers["set-cookie"];
      const value = Array.isArray(set) ? set[0] : set;
      if (typeof value === "string" && !value.includes("Max-Age=0")) {
        cookie = value.split(";")[0]!;
      }
    },
    header(): Record<string, string> {
      return cookie === null ? {} : { cookie };
    },
    get(): string | null {
      return cookie;
    },
  };
}

function csrfOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as Record<string, unknown>)["data"];
  if (typeof data !== "object" || data === null) return null;
  const token = (data as Record<string, unknown>)["csrf_token"];
  return typeof token === "string" ? token : null;
}

async function seedUser(db: Database, username: string, password: string, overrides: Record<string, unknown> = {}): Promise<number> {
  const hash = await PasswordHasher.hash(password);
  const result = await db.query(
    "INSERT INTO users (username, password_hash, display_name, avatar_url, email, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      username,
      hash,
      String(overrides["display_name"] ?? username),
      "",
      String(overrides["email"] ?? ""),
      String(overrides["role"] ?? "user"),
      String(overrides["status"] ?? "active"),
      "2026-01-01T00:00:00+00:00",
      "2026-01-01T00:00:00+00:00",
    ],
  );
  const row = (await db.query("SELECT id FROM users WHERE username = ?", [username])).rows[0];
  void result;
  return Number(row!["id"]);
}

async function getCsrfAndCookie(app: Awaited<ReturnType<typeof buildHarness>>["app"]): Promise<{ cookie: Record<string, string>; token: string }> {
  const jar1 = jar();
  const page = await app.inject({ method: "GET", url: "/login" });
  jar1.capture(page.headers as Record<string, unknown>);
  const token = csrfOf(page.json());
  assert.ok(token, "GET /login must expose a CSRF token for tests");
  return { cookie: jar1.header(), token };
}

function decodeFlash(headers: Record<string, unknown>): string {
  const raw = headers["x-flash-message"];
  return typeof raw === "string" ? Buffer.from(raw, "base64").toString("utf8") : "";
}

// -- CSRF ---------------------------------------------------------------------

test("state-changing POSTs without a CSRF token are rejected with the PHP session-expired flash", async () => {
  const { app, db } = await buildHarness();
  try {
    await seedUser(db, "alice", "password123");
    const response = await app.inject({ method: "POST", url: "/auth/password/login", payload: { username: "alice", password: "password123" } });
    assert.equal(response.statusCode, 303);
    assert.match(String(response.headers.location), /\/login/);
    assert.equal(decodeFlash(response.headers as Record<string, unknown>), "会话已过期，请重新操作。");
  } finally {
    await app.close();
    await db.close();
  }
});

test("a wrong CSRF token is rejected even with valid credentials", async () => {
  const { app, db } = await buildHarness();
  try {
    await seedUser(db, "alice", "password123");
    const { cookie } = await getCsrfAndCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/auth/password/login",
      headers: cookie,
      payload: { username: "alice", password: "password123", _csrf: "deadbeef" },
    });
    assert.equal(response.statusCode, 303);
    assert.match(String(response.headers.location), /\/login/);
  } finally {
    await app.close();
    await db.close();
  }
});

// -- Register -------------------------------------------------------------------

test("register validates username length, password length and confirmation, mirroring PHP order", async () => {
  const { app, db } = await buildHarness();
  try {
    const { cookie, token } = await getCsrfAndCookie(app);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ username: "ab", password: "longenough8", password_confirm: "longenough8", agreed: 1 }, "用户名长度需为 3-32 个字符。"],
      [{ username: "alice", password: "short1!", password_confirm: "short1!", agreed: 1 }, "密码至少需要 8 位。"],
      [{ username: "alice", password: "longenough8", password_confirm: "different1", agreed: 1 }, "两次输入的密码不一致。"],
      [{ username: "alice", password: "longenough8", password_confirm: "longenough8", agreed: 0 }, "请先阅读并同意服务说明。"],
      [{ username: "alice!", password: "longenough8", password_confirm: "longenough8", agreed: 1 }, "用户名仅支持字母、数字、下划线、短横线与中文。"],
    ];
    for (const [payload, expectedError] of cases) {
      const response = await app.inject({
        method: "POST",
        url: "/auth/password/register",
        headers: cookie,
        payload: { ...payload, _csrf: token },
      });
      assert.equal(response.statusCode, 303);
      assert.equal(String(response.headers.location), "/register");
      assert.equal(decodeFlash(response.headers as Record<string, unknown>), expectedError);
    }
    const count = Number((await db.query("SELECT COUNT(*) AS n FROM users")).rows[0]!["n"]);
    assert.equal(count, 0, "no user must be created by rejected registrations");
  } finally {
    await app.close();
    await db.close();
  }
});

test("register creates the account, hashes the password and logs the user in with a rotated session", async () => {
  const { app, db } = await buildHarness();
  try {
    const { cookie, token } = await getCsrfAndCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/auth/password/register",
      headers: cookie,
      payload: { username: "bob", password: "longenough8", password_confirm: "longenough8", display_name: "Bob", email: "bob@example.test", agreed: 1, _csrf: token },
    });
    assert.equal(response.statusCode, 303);
    assert.equal(String(response.headers.location), "/account");
    assert.equal(decodeFlash(response.headers as Record<string, unknown>), "注册成功，欢迎加入！");

    const row = (await db.query("SELECT * FROM users WHERE username = ?", ["bob"])).rows[0]!;
    assert.notEqual(row["password_hash"], "longenough8");
    assert.equal(row["display_name"], "Bob");
    assert.equal(row["email"], "bob@example.test");
    assert.equal(await PasswordHasher.verify("longenough8", row["password_hash"] as string), true);

    // Session was rotated on login: the new cookie's session now holds user_id.
    const jar1 = jar();
    jar1.capture(response.headers as Record<string, unknown>);
    assert.ok(jar1.get(), "login must set a session cookie");
  } finally {
    await app.close();
    await db.close();
  }
});

test("duplicate username registration is rejected without creating a second row", async () => {
  const { app, db } = await buildHarness();
  try {
    await seedUser(db, "taken", "password123");
    const { cookie, token } = await getCsrfAndCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/auth/password/register",
      headers: cookie,
      payload: { username: "taken", password: "longenough8", password_confirm: "longenough8", agreed: 1, _csrf: token },
    });
    assert.equal(decodeFlash(response.headers as Record<string, unknown>), "该用户名已被占用。");
    const count = Number((await db.query("SELECT COUNT(*) AS n FROM users WHERE username = ?", ["taken"])).rows[0]!["n"]);
    assert.equal(count, 1);
  } finally {
    await app.close();
    await db.close();
  }
});

// -- Login ------------------------------------------------------------------------

test("password login succeeds with correct credentials and rotates the session", async () => {
  const { app, db } = await buildHarness();
  try {
    await seedUser(db, "alice", "password123", { display_name: "Alice" });
    const { cookie, token } = await getCsrfAndCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/auth/password/login",
      headers: cookie,
      payload: { username: "alice", password: "password123", _csrf: token },
    });
    assert.equal(response.statusCode, 303);
    assert.equal(String(response.headers.location), "/");
    assert.equal(decodeFlash(response.headers as Record<string, unknown>), "欢迎回来，Alice");

    const row = (await db.query("SELECT last_login_at FROM users WHERE username = ?", ["alice"])).rows[0]!;
    assert.ok(row["last_login_at"], "last_login_at must be touched on login");

    // Old session id must no longer resolve: the login response cookie differs.
    const jar1 = jar();
    jar1.capture(response.headers as Record<string, unknown>);
    const account = await app.inject({ method: "GET", url: "/account", headers: jar1.header() });
    assert.equal(account.statusCode, 200);
  } finally {
    await app.close();
    await db.close();
  }
});

test("wrong password returns the non-enumerating PHP error", async () => {
  const { app, db } = await buildHarness();
  try {
    await seedUser(db, "alice", "password123");
    const { cookie, token } = await getCsrfAndCookie(app);
    const wrongPassword = await app.inject({
      method: "POST",
      url: "/auth/password/login",
      headers: cookie,
      payload: { username: "alice", password: "wrongpass1", _csrf: token },
    });
    const unknownUser = await app.inject({
      method: "POST",
      url: "/auth/password/login",
      headers: cookie,
      payload: { username: "nobody", password: "wrongpass1", _csrf: token },
    });
    const message = "用户名或密码错误。";
    assert.equal(decodeFlash(wrongPassword.headers as Record<string, unknown>), message);
    assert.equal(decodeFlash(unknownUser.headers as Record<string, unknown>), message, "unknown user must not be distinguishable");
    assert.equal(wrongPassword.statusCode, unknownUser.statusCode);
  } finally {
    await app.close();
    await db.close();
  }
});

test("disabled accounts are rejected without recording a throttle failure", async () => {
  const { app, db } = await buildHarness();
  try {
    await seedUser(db, "banned", "password123", { status: "disabled" });
    const { cookie, token } = await getCsrfAndCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/auth/password/login",
      headers: cookie,
      payload: { username: "banned", password: "password123", _csrf: token },
    });
    assert.equal(decodeFlash(response.headers as Record<string, unknown>), "该账号已被禁用。");
    const throttles = Number((await db.query("SELECT COUNT(*) AS n FROM auth_throttle")).rows[0]!["n"]);
    assert.equal(throttles, 0, "valid credentials on a disabled account must not count as failures");
  } finally {
    await app.close();
    await db.close();
  }
});

// -- Throttle / lockout --------------------------------------------------------------

test("five consecutive failures lock the username key for 15 minutes (deterministic clock)", async () => {
  const clock = new FixedClock();
  const { app, db } = await buildHarness({ clock });
  try {
    await seedUser(db, "alice", "password123");
    const { cookie, token } = await getCsrfAndCookie(app);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/auth/password/login",
        headers: cookie,
        payload: { username: "alice", password: `wrongpass${attempt}`, _csrf: token },
      });
      assert.equal(decodeFlash(response.headers as Record<string, unknown>), "用户名或密码错误。", `failure ${attempt + 1} must show the normal error`);
    }

    // 5 failures → locked: even a CORRECT password is now refused with the lock message.
    const locked = await app.inject({
      method: "POST",
      url: "/auth/password/login",
      headers: cookie,
      payload: { username: "alice", password: "password123", _csrf: token },
    });
    assert.equal(decodeFlash(locked.headers as Record<string, unknown>), "尝试次数过多，请稍后再试。");

    clock.advance(600); // 10 minutes — still inside the 15-minute lock
    const stillLocked = await app.inject({
      method: "POST",
      url: "/auth/password/login",
      headers: cookie,
      payload: { username: "alice", password: "password123", _csrf: token },
    });
    assert.equal(decodeFlash(stillLocked.headers as Record<string, unknown>), "尝试次数过多，请稍后再试。");

    clock.advance(301); // past 15 minutes from the lock moment
    const unlocked = await app.inject({
      method: "POST",
      url: "/auth/password/login",
      headers: cookie,
      payload: { username: "alice", password: "password123", _csrf: token },
    });
    assert.equal(decodeFlash(unlocked.headers as Record<string, unknown>), "欢迎回来，alice", "after the lock expires the correct password logs in");
  } finally {
    await app.close();
    await db.close();
  }
});

test("the ip key locks independently of the username key", async () => {
  const clock = new FixedClock();
  const { app, db } = await buildHarness({ clock });
  try {
    await seedUser(db, "alice", "password123");
    await seedUser(db, "mallory", "password123");
    const { cookie, token } = await getCsrfAndCookie(app);

    // Fail with two different usernames from the same IP: the ip: key sees 5 failures.
    const victims = ["alice", "mallory", "alice", "mallory", "alice"];
    for (const victim of victims) {
      await app.inject({ method: "POST", url: "/auth/password/login", headers: cookie, payload: { username: victim, password: "wrongpass9", _csrf: token } });
    }
    // The user: keys each have ≤ 3 failures, but ip: has 5 → locked.
    const locked = await app.inject({ method: "POST", url: "/auth/password/login", headers: cookie, payload: { username: "alice", password: "password123", _csrf: token } });
    assert.equal(decodeFlash(locked.headers as Record<string, unknown>), "尝试次数过多，请稍后再试。");
  } finally {
    await app.close();
    await db.close();
  }
});

test("a successful login clears the throttle counters", async () => {
  const { app, db } = await buildHarness();
  try {
    await seedUser(db, "alice", "password123");
    const { cookie, token } = await getCsrfAndCookie(app);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await app.inject({ method: "POST", url: "/auth/password/login", headers: cookie, payload: { username: "alice", password: "wrongpass1", _csrf: token } });
    }
    const success = await app.inject({ method: "POST", url: "/auth/password/login", headers: cookie, payload: { username: "alice", password: "password123", _csrf: token } });
    assert.equal(decodeFlash(success.headers as Record<string, unknown>), "欢迎回来，alice");
    const remaining = Number((await db.query("SELECT COUNT(*) AS n FROM auth_throttle")).rows[0]!["n"]);
    assert.equal(remaining, 0, "throttle rows must be cleared on success");
  } finally {
    await app.close();
    await db.close();
  }
});

// -- Logout ------------------------------------------------------------------------------

test("logout clears the session data, rotates the id and clears the cookie", async () => {
  const { app, db } = await buildHarness();
  try {
    await seedUser(db, "alice", "password123");
    const { cookie, token } = await getCsrfAndCookie(app);
    const login = await app.inject({ method: "POST", url: "/auth/password/login", headers: cookie, payload: { username: "alice", password: "password123", _csrf: token } });
    const loginJar = jar();
    loginJar.capture(login.headers as Record<string, unknown>);

    const logout = await app.inject({ method: "POST", url: "/logout", headers: loginJar.header(), payload: { _csrf: token } });
    assert.equal(logout.statusCode, 303);
    assert.equal(String(logout.headers.location), "/");
    assert.equal(decodeFlash(logout.headers as Record<string, unknown>), "已安全退出。");
    const setCookie = String(logout.headers["set-cookie"]);
    assert.match(setCookie, /Max-Age=0/, "logout must clear the session cookie");

    const after = await app.inject({ method: "GET", url: "/account", headers: loginJar.header() });
    assert.equal(after.statusCode, 303, "the old session must not authenticate after logout");
    assert.match(String(after.headers.location), /\/login/);
  } finally {
    await app.close();
    await db.close();
  }
});

// -- Social callback flow --------------------------------------------------------------------

test("social callback with a bad state is rejected before any provider call", async () => {
  const { app, db, socialProvider } = await buildHarness();
  try {
    const { cookie } = await getCsrfAndCookie(app);
    // No authorizeUrl was hit, so no social_state exists in the session.
    const response = await app.inject({ method: "GET", url: "/auth/social/callback?provider=qq&code=c1&state=forged", headers: cookie });
    assert.equal(response.statusCode, 303);
    assert.match(String(response.headers.location), /\/login$/);
    assert.equal(decodeFlash(response.headers as Record<string, unknown>), "登录状态校验失败，请重试。");
    assert.equal(socialProvider.calls.length, 0, "the provider must never be contacted on a state mismatch");
  } finally {
    await app.close();
    await db.close();
  }
});

test("existing social identity logs the user in; new identity forces the completion form", async () => {
  const { app, db, socialProvider } = await buildHarness();
  try {
    // Existing identity → direct login.
    const userId = await seedUser(db, "alice", "password123", { display_name: "Alice" });
    await db.query("INSERT INTO social_identities (user_id, provider, social_uid, nickname, avatar_url, created_at, updated_at) VALUES (?, 'qq', 'qq-uid-1', 'Alice', '', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')", [userId]);
    socialProvider.setProfile("qq", "code-known", { social_uid: "qq-uid-1", nickname: "Alice", avatar_url: "" });

    let { cookie, token } = await getCsrfAndCookie(app);
    // Simulate the authorize step having stored the one-time state.
    const authorize1 = await app.inject({ method: "GET", url: "/auth/social/qq", headers: cookie });
    assert.equal(authorize1.statusCode, 303);
    cookie = updatedCookie(cookie, authorize1.headers as Record<string, unknown>);
    const callback = await app.inject({ method: "GET", url: "/auth/social/callback?provider=qq&code=code-known&state=stub-state", headers: cookie });
    assert.equal(callback.statusCode, 303);
    assert.equal(String(callback.headers.location), "/account");
    assert.equal(decodeFlash(callback.headers as Record<string, unknown>), "登录成功！");

    // Brand-new identity → needs_signup → completion form, no user created yet.
    socialProvider.setProfile("qq", "code-new", { social_uid: "qq-uid-2", nickname: "小新", avatar_url: "" });
    ({ cookie, token } = await getCsrfAndCookie(app));
    const authorize2 = await app.inject({ method: "GET", url: "/auth/social/qq", headers: cookie });
    cookie = updatedCookie(cookie, authorize2.headers as Record<string, unknown>);
    const firstTime = await app.inject({ method: "GET", url: "/auth/social/callback?provider=qq&code=code-new&state=stub-state", headers: cookie });
    assert.equal(firstTime.statusCode, 303);
    assert.equal(String(firstTime.headers.location), "/complete-social");
    const users = Number((await db.query("SELECT COUNT(*) AS n FROM users WHERE username = '小新'")).rows[0]!["n"]);
    assert.equal(users, 0, "no account may exist before the completion form is submitted");
  } finally {
    await app.close();
    await db.close();
  }
});

test("social completion creates the account, binds the identity and logs in", async () => {
  const { app, db, socialProvider } = await buildHarness();
  try {
    socialProvider.setProfile("wx", "code-new", { social_uid: "wx-uid-9", nickname: "小新", avatar_url: "https://cdn.example.test/a.png" });
    const { cookie, token } = await getCsrfAndCookie(app);
    const authorize = await app.inject({ method: "GET", url: "/auth/social/wx", headers: cookie });
    const cookie2 = updatedCookie(cookie, authorize.headers as Record<string, unknown>);
    await app.inject({ method: "GET", url: "/auth/social/callback?provider=wx&code=code-new&state=stub-state", headers: cookie2 });

    // Fetch a fresh CSRF token from the completion page session.
    const page = await app.inject({ method: "GET", url: "/complete-social", headers: cookie2 });
    const completionToken = csrfOf(page.json());
    assert.ok(completionToken, "completion page must expose a CSRF token");

    const complete = await app.inject({
      method: "POST",
      url: "/complete-social",
      headers: cookie2,
      payload: { username: "", password: "longenough8", password_confirm: "longenough8", email: "", _csrf: completionToken },
    });
    assert.equal(complete.statusCode, 303);
    assert.equal(String(complete.headers.location), "/account");
    assert.equal(decodeFlash(complete.headers as Record<string, unknown>), "账号创建成功，欢迎加入！");

    // Username derived from the nickname (2 chars → padded with '_').
    const row = (await db.query("SELECT * FROM users WHERE display_name = '小新'")).rows[0]!;
    assert.equal(row["username"], "小新_", "nickname-derived username must be padded to the 3-char minimum");
    assert.equal(await PasswordHasher.verify("longenough8", row["password_hash"] as string), true);
    const identity = (await db.query("SELECT * FROM social_identities WHERE social_uid = 'wx-uid-9'")).rows[0]!;
    assert.equal(Number(identity["user_id"]), Number(row["id"]), "the social identity must be bound to the new account");
  } finally {
    await app.close();
    await db.close();
  }
});

test("an already-authenticated browser is not switched by a second social callback", async () => {
  const { app, db, socialProvider } = await buildHarness();
  try {
    const aliceId = await seedUser(db, "alice", "password123");
    const bobId = await seedUser(db, "bob", "password123");
    await db.query("INSERT INTO social_identities (user_id, provider, social_uid, nickname, avatar_url, created_at, updated_at) VALUES (?, 'qq', 'qq-uid-bob', 'Bob', '', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')", [bobId]);
    socialProvider.setProfile("qq", "code-bob", { social_uid: "qq-uid-bob", nickname: "Bob", avatar_url: "" });

    const { cookie, token } = await getCsrfAndCookie(app);
    const login = await app.inject({ method: "POST", url: "/auth/password/login", headers: cookie, payload: { username: "alice", password: "password123", _csrf: token } });
    const sessionJar = jar();
    sessionJar.capture(login.headers as Record<string, unknown>);

    // Start + finish a social flow while logged in as alice — must NOT switch to bob.
    // PHP: an authenticated visitor's authorize click enters bind mode, and the
    // "already logged in" guard on the callback redirects to /account.
    const authorize = await app.inject({ method: "GET", url: "/auth/social/qq", headers: sessionJar.header() });
    const cookie3 = updatedCookie(sessionJar.header()["cookie"], authorize.headers as Record<string, unknown>).cookie ?? "";
    const callback = await app.inject({ method: "GET", url: "/auth/social/callback?provider=qq&code=code-bob&state=stub-state", headers: { cookie: cookie3 } });
    assert.equal(callback.statusCode, 303);
    assert.equal(String(callback.headers.location), "/account/connections");
    // PHP bindToCurrentUser: the qq identity belongs to bob → binding refused,
    // alice's session stays intact (verified below).
    assert.equal(decodeFlash(callback.headers as Record<string, unknown>), "该QQ账号已绑定到其他账号，无法重复绑定。");

    const me = await app.inject({ method: "GET", url: "/account", headers: sessionJar.header() });
    assert.equal(me.statusCode, 200);
    const stillAlice = (await db.query("SELECT username FROM users WHERE id = ?", [aliceId])).rows[0];
    assert.equal(stillAlice!["username"], "alice");
  } finally {
    await app.close();
    await db.close();
  }
});

test("bind mode attaches the identity to the current account instead of switching", async () => {
  const { app, db, socialProvider } = await buildHarness();
  try {
    await seedUser(db, "alice", "password123");
    socialProvider.setProfile("qq", "code-bind", { social_uid: "qq-uid-bind", nickname: "AliceQQ", avatar_url: "" });

    const { cookie, token } = await getCsrfAndCookie(app);
    const login = await app.inject({ method: "POST", url: "/auth/password/login", headers: cookie, payload: { username: "alice", password: "password123", _csrf: token } });
    const sessionJar = jar();
    sessionJar.capture(login.headers as Record<string, unknown>);

    const authorize = await app.inject({ method: "GET", url: "/auth/social/qq?redirect=/account", headers: sessionJar.header() });
    const cookie3 = updatedCookie(sessionJar.header()["cookie"], authorize.headers as Record<string, unknown>).cookie ?? "";
    const callback = await app.inject({ method: "GET", url: "/auth/social/callback?provider=qq&code=code-bind&state=stub-state", headers: { cookie: cookie3 } });
    assert.equal(callback.statusCode, 303);
    // PHP binds for an authenticated browser and lands on the connections page.
    assert.equal(String(callback.headers.location), "/account/connections");
    assert.equal(decodeFlash(callback.headers as Record<string, unknown>), "绑定成功！");

    const row = (await db.query("SELECT * FROM social_identities WHERE social_uid = 'qq-uid-bind'")).rows[0]!;
    const alice = (await db.query("SELECT id FROM users WHERE username = 'alice'")).rows[0]!;
    assert.equal(Number(row["user_id"]), Number(alice["id"]));
  } finally {
    await app.close();
    await db.close();
  }
});

test("provider exchange failures surface the generic PHP error without leaking diagnostics", async () => {
  const { app, db, socialProvider } = await buildHarness();
  try {
    socialProvider.failExchange = true;
    const { cookie } = await getCsrfAndCookie(app);
    const authorize = await app.inject({ method: "GET", url: "/auth/social/qq", headers: cookie });
    const cookie2 = updatedCookie(cookie, authorize.headers as Record<string, unknown>);
    const callback = await app.inject({ method: "GET", url: "/auth/social/callback?provider=qq&code=code-x&state=stub-state", headers: cookie2 });
    assert.equal(callback.statusCode, 303);
    assert.match(String(callback.headers.location), /\/login$/);
    assert.equal(decodeFlash(callback.headers as Record<string, unknown>), "第三方登录失败，请稍后重试或联系管理员。");
    assert.doesNotMatch(callback.body, /aggregate down/);
  } finally {
    await app.close();
    await db.close();
  }
});

// -- Account routes ---------------------------------------------------------------------------

async function loginAs(app: Awaited<ReturnType<typeof buildHarness>>["app"], username: string, password: string) {
  const { cookie, token } = await getCsrfAndCookie(app);
  const login = await app.inject({ method: "POST", url: "/auth/password/login", headers: cookie, payload: { username, password, _csrf: token } });
  const sessionJar = jar();
  sessionJar.capture(login.headers as Record<string, unknown>);
  // After login the session was rotated; fetch a fresh CSRF token from an
  // authenticated GET page (the login page would redirect away when authed).
  const profilePage = await app.inject({ method: "GET", url: "/account/profile", headers: sessionJar.header() });
  const freshToken = csrfOf(profilePage.json());
  return { cookie: sessionJar.header(), token: freshToken ?? token, sessionJar };
}

test("account routes redirect anonymous visitors to the login page with a redirect parameter", async () => {
  const { app, db } = await buildHarness();
  try {
    for (const url of ["/account", "/account/orders", "/account/cards", "/account/connections", "/account/security", "/account/profile"]) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 303, `${url} must redirect when anonymous`);
      assert.match(String(response.headers.location), /\/login\?redirect=/, `${url} must carry a redirect parameter`);
    }
  } finally {
    await app.close();
    await db.close();
  }
});

test("account overview returns order/card/connection aggregates for the logged-in user", async () => {
  const { app, db } = await buildHarness();
  try {
    const userId = await seedUser(db, "alice", "password123");
    await db.query(
      "INSERT INTO orders (order_no, user_id, amount_due_cents, amount_paid_cents, payment_status, fulfillment_status, created_at, updated_at) VALUES ('ORD-1', ?, 1000, 1000, 'paid', 'success', '2026-01-02T00:00:00+00:00', '2026-01-02T00:00:00+00:00')",
      [userId],
    );
    const order = (await db.query("SELECT id FROM orders WHERE order_no = 'ORD-1'")).rows[0]!;
    await db.query("INSERT INTO order_items (order_id, product_id, product_name_snapshot, created_at) VALUES (?, 1, 'Voice Card', '2026-01-02T00:00:00+00:00')", [Number(order["id"])]);
    const item = (await db.query("SELECT id FROM order_items WHERE order_id = ?", [Number(order["id"])])).rows[0]!;
    await db.query(
      "INSERT INTO fulfillment_units (order_id, order_item_id, unit_index, unit_no, delivery_code_ciphertext, status, created_at, updated_at) VALUES (?, ?, 1, 'U1', 'v1:abc', 'success', '2026-01-02T00:00:00+00:00', '2026-01-02T00:00:00+00:00')",
      [Number(order["id"]), Number(item["id"])],
    );
    await db.query("INSERT INTO social_identities (user_id, provider, social_uid, nickname, avatar_url, created_at, updated_at) VALUES (?, 'qq', 'qq-1', 'Alice', '', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')", [userId]);

    const { cookie } = await loginAs(app, "alice", "password123");
    const response = await app.inject({ method: "GET", url: "/account", headers: cookie });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.template, "account/overview");
    assert.equal(body.data.order_count, 1);
    assert.equal(body.data.card_count, 1);
    assert.equal(body.data.connections.length, 1);
    assert.equal(body.data.has_password, true);
    assert.equal(body.data.recent_orders.length, 1);
    assert.equal(body.data.recent_orders[0]["first_item_name"], "Voice Card");
  } finally {
    await app.close();
    await db.close();
  }
});

test("account orders/cards/connections/security/profile pages render for the session owner", async () => {
  const { app, db } = await buildHarness();
  try {
    await seedUser(db, "alice", "password123");
    const { cookie } = await loginAs(app, "alice", "password123");
    const cases: Array<[string, string]> = [
      ["/account/orders", "account/orders"],
      ["/account/cards", "account/cards"],
      ["/account/connections", "account/connections"],
      ["/account/security", "account/security"],
      ["/account/profile", "account/profile"],
    ];
    for (const [url, template] of cases) {
      const response = await app.inject({ method: "GET", url, headers: cookie });
      assert.equal(response.statusCode, 200, `${url} must render`);
      assert.equal(response.json().template, template);
    }
    // Filters must not crash: status + q + page.
    const filtered = await app.inject({ method: "GET", url: "/account/orders?status=paid&q=ORD&page=2", headers: cookie });
    assert.equal(filtered.statusCode, 200);
    assert.equal(filtered.json().data.page, 2);
  } finally {
    await app.close();
    await db.close();
  }
});

test("change password validates current password, minimum length and confirmation", async () => {
  const { app, db } = await buildHarness();
  try {
    await seedUser(db, "alice", "password123");
    const { cookie, token } = await loginAs(app, "alice", "password123");

    const wrongCurrent = await app.inject({
      method: "POST",
      url: "/account/security/password",
      headers: cookie,
      payload: { current_password: "wrongpass1", new_password: "newpassword1", new_password_confirm: "newpassword1", _csrf: token },
    });
    assert.equal(decodeFlash(wrongCurrent.headers as Record<string, unknown>), "当前密码不正确。");

    const tooShort = await app.inject({
      method: "POST",
      url: "/account/security/password",
      headers: cookie,
      payload: { current_password: "password123", new_password: "short1", new_password_confirm: "short1", _csrf: token },
    });
    assert.equal(decodeFlash(tooShort.headers as Record<string, unknown>), "新密码至少需要 8 位。");

    const mismatch = await app.inject({
      method: "POST",
      url: "/account/security/password",
      headers: cookie,
      payload: { current_password: "password123", new_password: "newpassword1", new_password_confirm: "different22", _csrf: token },
    });
    assert.equal(decodeFlash(mismatch.headers as Record<string, unknown>), "两次输入的新密码不一致。");

    const ok = await app.inject({
      method: "POST",
      url: "/account/security/password",
      headers: cookie,
      payload: { current_password: "password123", new_password: "newpassword1", new_password_confirm: "newpassword1", _csrf: token },
    });
    assert.equal(decodeFlash(ok.headers as Record<string, unknown>), "密码已更新。");
    const row = (await db.query("SELECT password_hash FROM users WHERE username = 'alice'")).rows[0]!;
    assert.equal(await PasswordHasher.verify("newpassword1", row["password_hash"] as string), true);
    assert.equal(await PasswordHasher.verify("password123", row["password_hash"] as string), false);
  } finally {
    await app.close();
    await db.close();
  }
});

test("profile update validates username/nickname/email and persists changes", async () => {
  const { app, db } = await buildHarness();
  try {
    await seedUser(db, "alice", "password123", { email: "old@example.test" });
    const { cookie, token } = await loginAs(app, "alice", "password123");

    const badUsername = await app.inject({
      method: "POST",
      url: "/account/profile",
      headers: cookie,
      payload: { username: "bad name!", display_name: "", email: "old@example.test", _csrf: token },
    });
    assert.equal(decodeFlash(badUsername.headers as Record<string, unknown>), "用户名仅支持字母、数字、下划线、短横线与中文。");

    const badNickname = await app.inject({
      method: "POST",
      url: "/account/profile",
      headers: cookie,
      payload: { username: "alice", display_name: "x".repeat(51), email: "old@example.test", _csrf: token },
    });
    assert.equal(decodeFlash(badNickname.headers as Record<string, unknown>), "昵称长度不能超过 50 个字符。");

    const badEmail = await app.inject({
      method: "POST",
      url: "/account/profile",
      headers: cookie,
      payload: { username: "alice", display_name: "Alice", email: "not-an-email", _csrf: token },
    });
    assert.equal(decodeFlash(badEmail.headers as Record<string, unknown>), "邮箱格式不正确。");

    const ok = await app.inject({
      method: "POST",
      url: "/account/profile",
      headers: cookie,
      payload: { username: "alice2", display_name: "Alice II", email: "new@example.test", _csrf: token },
    });
    assert.equal(decodeFlash(ok.headers as Record<string, unknown>), "账号信息已更新。");
    const row = (await db.query("SELECT * FROM users WHERE username = 'alice2'")).rows[0]!;
    assert.equal(row["display_name"], "Alice II");
    assert.equal(row["email"], "new@example.test");
  } finally {
    await app.close();
    await db.close();
  }
});

test("connections unbind refuses to remove the last login method and requires CSRF", async () => {
  const { app, db } = await buildHarness();
  try {
    const userId = await seedUser(db, "alice", "password123");
    await db.query("INSERT INTO social_identities (user_id, provider, social_uid, nickname, avatar_url, created_at, updated_at) VALUES (?, 'qq', 'qq-1', 'Alice', '', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')", [userId]);
    const { cookie, token } = await loginAs(app, "alice", "password123");

    // No CSRF → rejected.
    const noCsrf = await app.inject({ method: "POST", url: "/account/connections/unbind", headers: cookie, payload: { provider: "qq" } });
    assert.equal(decodeFlash(noCsrf.headers as Record<string, unknown>), "会话已过期，请重新操作。");

    // Password + one identity = 2 methods → unbind allowed.
    const ok = await app.inject({ method: "POST", url: "/account/connections/unbind", headers: cookie, payload: { provider: "qq", _csrf: token } });
    assert.equal(decodeFlash(ok.headers as Record<string, unknown>), "已解绑 QQ 登录。");
    const remaining = Number((await db.query("SELECT COUNT(*) AS n FROM social_identities WHERE user_id = ?", [userId])).rows[0]!["n"]);
    assert.equal(remaining, 0);

    // Unbind something not bound → PHP message.
    const missing = await app.inject({ method: "POST", url: "/account/connections/unbind", headers: cookie, payload: { provider: "qq", _csrf: token } });
    assert.equal(decodeFlash(missing.headers as Record<string, unknown>), "该登录方式未绑定。");

    // Unsupported provider.
    const unsupported = await app.inject({ method: "POST", url: "/account/connections/unbind", headers: cookie, payload: { provider: "wechat", _csrf: token } });
    assert.equal(decodeFlash(unsupported.headers as Record<string, unknown>), "不支持的登录方式。");
  } finally {
    await app.close();
    await db.close();
  }
});

test("unbind keeps at least one login method", async () => {
  const { app, db } = await buildHarness();
  try {
    const userId = await seedUser(db, "alice", "password123");
    await db.query("INSERT INTO social_identities (user_id, provider, social_uid, nickname, avatar_url, created_at, updated_at) VALUES (?, 'qq', 'qq-1', 'Alice', '', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')", [userId]);
    const { cookie, token } = await loginAs(app, "alice", "password123");
    // Remove the password so the QQ identity is the only method left.
    await db.query("UPDATE users SET password_hash = NULL WHERE id = ?", [userId]);
    const refused = await app.inject({ method: "POST", url: "/account/connections/unbind", headers: cookie, payload: { provider: "qq", _csrf: token } });
    assert.equal(decodeFlash(refused.headers as Record<string, unknown>), "至少需要保留一种登录方式。");
    const remaining = Number((await db.query("SELECT COUNT(*) AS n FROM social_identities WHERE user_id = ?", [userId])).rows[0]!["n"]);
    assert.equal(remaining, 1, "the last login method must survive");
  } finally {
    await app.close();
    await db.close();
  }
});

test("account/complete sets a username+password on a social-only account exactly once", async () => {
  const { app, db, deps } = await buildHarness();
  try {
    const userId = await seedUser(db, "tempuser", "");
    await db.query("UPDATE users SET password_hash = NULL WHERE id = ?", [userId]);
    // A password-less social account cannot log in with a password (PHP
    // requires credentials); seed an authenticated session directly instead.
    const { cookie, token } = await getCsrfAndCookie(app);
    const sessionCookie = (cookie.cookie ?? "").split(";")[0] ?? "";
    const sessionId = sessionCookie.split("=")[1] ?? "";
    await deps.sessions.save(sessionId, { user_id: userId, csrf_token: token });

    const shortPassword = await app.inject({
      method: "POST",
      url: "/account/complete",
      headers: cookie,
      payload: { username: "tempuser", password: "short1", password_confirm: "short1", _csrf: token },
    });
    assert.equal(decodeFlash(shortPassword.headers as Record<string, unknown>), "密码至少需要 8 位。");

    const ok = await app.inject({
      method: "POST",
      url: "/account/complete",
      headers: cookie,
      payload: { username: "tempuser", password: "newpassword1", password_confirm: "newpassword1", _csrf: token },
    });
    assert.equal(decodeFlash(ok.headers as Record<string, unknown>), "账号设置完成，已使用用户名和密码登录。");

    const row = (await db.query("SELECT password_hash FROM users WHERE id = ?", [userId])).rows[0]!;
    assert.equal(await PasswordHasher.verify("newpassword1", row["password_hash"] as string), true);

    const second = await app.inject({
      method: "POST",
      url: "/account/complete",
      headers: cookie,
      payload: { username: "tempuser", password: "anotherpass1", password_confirm: "anotherpass1", _csrf: token },
    });
    assert.equal(decodeFlash(second.headers as Record<string, unknown>), "该账号已设置密码，请直接在账号信息中修改。");
  } finally {
    await app.close();
    await db.close();
  }
});

// -- helpers ----------------------------------------------------------------------------------

/** Merge a Set-Cookie from a response into an existing cookie header value. */
function updatedCookie(existing: string | undefined | Record<string, string>, headers: Record<string, unknown>): Record<string, string> {
  const base = typeof existing === "string" ? existing.replace(/^cookie=/, "") : existing?.cookie ?? undefined;
  const set = headers["set-cookie"];
  const value = Array.isArray(set) ? set[0] : set;
  const parts = new Set<string>();
  if (typeof base === "string" && base !== "") {
    for (const piece of base.split(";")) parts.add(piece.trim());
  }
  if (typeof value === "string") {
    const newCookie = value.split(";")[0]!;
    if (!newCookie.endsWith("=") && !value.includes("Max-Age=0")) {
      parts.delete(newCookie.split("=")[0]!);
      parts.add(newCookie);
    }
  }
  return parts.size > 0 ? { cookie: [...parts].join("; ") } : {};
}
