import assert from "node:assert/strict";
import test from "node:test";
import { AggregateLoginError, AggregateOAuthProvider, resolveEndpoint } from "../src/aggregate-oauth.js";

/** Minimal ConfigPort double (only the members the provider reads). */
function config(values: Record<string, string>) {
  return {
    get: (key: string, fallback = "") => values[key] ?? fallback,
    bool: (key: string, fallback: boolean) => {
      const raw = values[key];
      if (raw === undefined || raw === "") return fallback;
      return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
    },
    int: (key: string, fallback: number) => {
      const parsed = Number.parseInt(values[key] ?? "", 10);
      return Number.isNaN(parsed) ? fallback : parsed;
    },
    authUrl: (route: string) => route,
  };
}

interface Call {
  url: string;
}

/** Fake fetch recording URLs and replaying queued JSON bodies. */
function fakeFetch(bodies: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = async (url: string) => {
    calls.push({ url });
    const next = bodies.shift() ?? { body: { code: 0 } };
    return {
      ok: (next.status ?? 200) >= 200 && (next.status ?? 200) < 300,
      status: next.status ?? 200,
      json: async () => next.body,
    };
  };
  return { impl, calls };
}

const creds = {
  AGGREGATE_OAUTH_APP_ID: "1001",
  AGGREGATE_OAUTH_APP_KEY: "secret-key",
  APP_URL: "https://vhpay.example.test",
};

test("authorizeUrl calls act=login with appid/appkey/type/redirect_uri/state and returns the https url", async () => {
  const { impl, calls } = fakeFetch([{ body: { code: 0, url: "https://open.qq.example/authorize?x=1" } }]);
  const provider = new AggregateOAuthProvider(config(creds), impl);
  const result = await provider.authorizeUrl("qq", "/account");

  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url);
  assert.equal(url.host, "a.idcfx.net");
  assert.equal(url.pathname, "/connect.php");
  assert.equal(url.searchParams.get("act"), "login");
  assert.equal(url.searchParams.get("appid"), "1001");
  assert.equal(url.searchParams.get("appkey"), "secret-key");
  assert.equal(url.searchParams.get("type"), "qq");
  assert.equal(url.searchParams.get("redirect_uri"), "https://vhpay.example.test/auth/social/callback?provider=qq");
  assert.match(url.searchParams.get("state") ?? "", /^[0-9a-f]{32}$/);

  assert.equal(result.url, "https://open.qq.example/authorize?x=1");
  assert.equal(result.state, url.searchParams.get("state"));
});

test("authorizeUrl honours a custom endpoint and keeps the wx provider name", async () => {
  const { impl, calls } = fakeFetch([{ body: { code: 0, url: "https://open.weixin.example/qr" } }]);
  const provider = new AggregateOAuthProvider(
    config({ ...creds, AGGREGATE_OAUTH_ENDPOINT: "https://a.example.net/api/connect.php/" }),
    impl,
  );
  await provider.authorizeUrl("wx", "/");
  const url = new URL(calls[0]!.url);
  assert.equal(url.host, "a.example.net");
  assert.equal(url.pathname, "/api/connect.php");
  assert.equal(url.searchParams.get("type"), "wx");
});

test("exchangeCode normalizes social_uid/nickname/faceimg", async () => {
  const { impl, calls } = fakeFetch([
    { body: { code: 0, social_uid: "UID-42", nickname: "小明", faceimg: "https://img.example/a.png", type: "wx" } },
  ]);
  const provider = new AggregateOAuthProvider(config(creds), impl);
  const profile = await provider.exchangeCode("wx", "CODE123");

  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("act"), "callback");
  assert.equal(url.searchParams.get("code"), "CODE123");
  assert.deepEqual(profile, {
    social_uid: "UID-42",
    nickname: "小明",
    avatar_url: "https://img.example/a.png",
  });
});

test("exchangeCode rejects a mismatched provider echo", async () => {
  const { impl } = fakeFetch([{ body: { code: 0, social_uid: "UID-1", type: "qq" } }]);
  const provider = new AggregateOAuthProvider(config(creds), impl);
  await assert.rejects(() => provider.exchangeCode("wx", "c"), /登录方式不匹配/);
});

test("missing credentials fail fast without a network call", async () => {
  const { impl, calls } = fakeFetch([]);
  const provider = new AggregateOAuthProvider(config({ APP_URL: creds.APP_URL }), impl);
  await assert.rejects(() => provider.authorizeUrl("qq", "/"), AggregateLoginError);
  assert.equal(calls.length, 0);
});

test("non-zero code, bad JSON and non-https authorize url are rejected", async () => {
  const failure = fakeFetch([{ body: { code: 1, msg: "appkey 错误" } }]);
  await assert.rejects(
    () => new AggregateOAuthProvider(config(creds), failure.impl).authorizeUrl("qq", "/"),
    /appkey 错误/,
  );

  const garbage = fakeFetch([{ body: "not-json" }]);
  await assert.rejects(
    () => new AggregateOAuthProvider(config(creds), garbage.impl).authorizeUrl("qq", "/"),
    /无效 JSON/,
  );

  const insecure = fakeFetch([{ body: { code: 0, url: "http://open.qq.example/x" } }]);
  await assert.rejects(
    () => new AggregateOAuthProvider(config(creds), insecure.impl).authorizeUrl("qq", "/"),
    /无效的授权地址/,
  );

  const http500 = fakeFetch([{ status: 500, body: {} }]);
  await assert.rejects(
    () => new AggregateOAuthProvider(config(creds), http500.impl).authorizeUrl("qq", "/"),
    /HTTP 500/,
  );
});

test("resolveEndpoint enforces https and a path", () => {
  assert.equal(resolveEndpoint("https://a.idcfx.net/connect.php"), "https://a.idcfx.net/connect.php");
  assert.equal(resolveEndpoint("https://a.idcfx.net/api/connect.php/"), "https://a.idcfx.net/api/connect.php");
  assert.throws(() => resolveEndpoint("http://a.idcfx.net/connect.php"), /HTTPS/);
  assert.throws(() => resolveEndpoint("https://a.idcfx.net"), /缺少路径/);
  assert.throws(() => resolveEndpoint("https://user:pass@a.idcfx.net/connect.php"), /凭据/);
});
