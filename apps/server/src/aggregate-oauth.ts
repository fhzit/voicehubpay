/**
 * 任性聚合登录 (Aggregate OAuth) provider — PHP `VoiceHubPay\SocialAuth` parity.
 *
 * QQ and WeChat share one Aggregate AppID/AppKey; the local provider name stays
 * `qq` / `wx` so existing `social_identities` rows remain valid.
 *
 * Wire protocol (`https://a.idcfx.net/connect.php`, all GET, JSON reply):
 *   act=login&appid&appkey&type&redirect_uri&state  -> {code:0, url}
 *   act=callback&appid&appkey&type&code            -> {code:0, social_uid, nickname, faceimg, type}
 *
 * Configuration (env, materialised from the PHP settings store at deploy time):
 *   AGGREGATE_OAUTH_APP_ID, AGGREGATE_OAUTH_APP_KEY,
 *   AGGREGATE_OAUTH_ENDPOINT (default https://a.idcfx.net/connect.php),
 *   APP_URL (callback base, `/auth/social/callback?provider=…`).
 */

import { randomBytes } from "node:crypto";
import type {
  ConfigPort,
  SocialAuthorizeResult,
  SocialAuthProvider,
  SocialProfile,
} from "./auth-legacy/index.js";

const DEFAULT_ENDPOINT = "https://a.idcfx.net/connect.php";
const SUPPORTED = new Set(["qq", "wx"]);

export class AggregateLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AggregateLoginError";
  }
}

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Validated HTTPS endpoint; mirrors `SocialAuth::endpoint()`. */
export function resolveEndpoint(raw: string): string {
  const value = (raw || DEFAULT_ENDPOINT).trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AggregateLoginError("任性聚合登录接口地址不是有效 URL。");
  }
  if (url.protocol !== "https:") throw new AggregateLoginError("任性聚合登录接口地址必须是 HTTPS URL。");
  if (url.username !== "" || url.password !== "") throw new AggregateLoginError("任性聚合登录接口地址不能包含凭据。");
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "") throw new AggregateLoginError("任性聚合登录接口地址缺少路径。");
  return `https://${url.host}${path}`;
}

export class AggregateOAuthProvider implements SocialAuthProvider {
  constructor(
    private readonly config: ConfigPort,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly baseUrl: () => string = () => "",
  ) {}

  private credentials(): { appId: string; appKey: string } {
    const appId = this.config.get("AGGREGATE_OAUTH_APP_ID", "").trim();
    const appKey = this.config.get("AGGREGATE_OAUTH_APP_KEY", "").trim();
    if (appId === "" || appKey === "") throw new AggregateLoginError("任性聚合登录 AppID/AppKey 尚未配置。");
    return { appId, appKey };
  }

  private provider(provider: string): string {
    if (!SUPPORTED.has(provider)) throw new AggregateLoginError("不支持的聚合登录方式。");
    return provider;
  }

  private callbackUrl(provider: string): string {
    const base = (this.config.get("APP_URL", "") || this.baseUrl()).replace(/\/+$/, "");
    if (base === "") throw new AggregateLoginError("APP_URL 未配置，无法生成聚合登录回调地址。");
    return `${base}/auth/social/callback?provider=${encodeURIComponent(provider)}`;
  }

  private async request(params: Record<string, string>): Promise<Record<string, unknown>> {
    const endpoint = resolveEndpoint(this.config.get("AGGREGATE_OAUTH_ENDPOINT", DEFAULT_ENDPOINT));
    const query = new URLSearchParams(params).toString();
    const response = await this.fetchImpl(`${endpoint}?${query}`, {
      headers: { accept: "application/json", "user-agent": "VoiceHubPay/2.0" },
    });
    if (!response.ok) throw new AggregateLoginError(`聚合登录接口请求失败（HTTP ${response.status}）。`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AggregateLoginError("聚合登录接口返回了无效 JSON。");
    }
    if (typeof body !== "object" || body === null) throw new AggregateLoginError("聚合登录接口返回了无效 JSON。");
    const record = body as Record<string, unknown>;
    const code = Number(record["code"] ?? -1);
    if (!Number.isFinite(code) || code !== 0) {
      throw new AggregateLoginError(`聚合登录失败：${String(record["msg"] ?? "unknown error")}`);
    }
    return record;
  }

  async authorizeUrl(provider: string, _redirectAfter: string): Promise<SocialAuthorizeResult> {
    const type = this.provider(provider);
    const { appId, appKey } = this.credentials();
    const state = randomBytes(16).toString("hex");
    const response = await this.request({
      act: "login",
      appid: appId,
      appkey: appKey,
      type,
      redirect_uri: this.callbackUrl(type),
      state,
    });
    const url = String(response["url"] ?? "").trim();
    if (url === "") throw new AggregateLoginError("聚合登录未返回授权地址。");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AggregateLoginError("聚合登录返回了无效的授权地址。");
    }
    if (parsed.protocol !== "https:" || parsed.hostname === "" || parsed.username !== "" || parsed.password !== "") {
      throw new AggregateLoginError("聚合登录返回了无效的授权地址。");
    }
    return { url, state };
  }

  async exchangeCode(provider: string, code: string): Promise<SocialProfile> {
    const type = this.provider(provider);
    const { appId, appKey } = this.credentials();
    const response = await this.request({
      act: "callback",
      appid: appId,
      appkey: appKey,
      type,
      code,
    });
    const socialUid = String(response["social_uid"] ?? "").trim();
    if (socialUid === "") throw new AggregateLoginError("聚合登录未返回 social_uid。");
    const returnedType = String(response["type"] ?? type);
    if (returnedType !== type) throw new AggregateLoginError("聚合登录返回的登录方式不匹配。");
    return {
      social_uid: socialUid,
      nickname: String(response["nickname"] ?? ""),
      avatar_url: String(response["faceimg"] ?? ""),
    };
  }
}
