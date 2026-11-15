/**
 * Environment-driven social login provider (QQ / WeChat aggregate login).
 *
 * Mirrors the PHP `SocialAuth` adapter contract: `authorizeUrl()` returns the
 * provider URL plus the CSRF state that the route stores in the session, and
 * `exchangeCode()` turns the callback code into a normalized profile.
 *
 * Configuration (all optional — leaving them empty disables the provider and
 * the login page hides the corresponding button via *_LOGIN_ENABLED):
 *   OAUTH_QQ_CLIENT_ID / OAUTH_QQ_CLIENT_SECRET / OAUTH_QQ_REDIRECT_URI
 *   OAUTH_WX_CLIENT_ID / OAUTH_WX_CLIENT_SECRET / OAUTH_WX_REDIRECT_URI
 *
 * The token/profile endpoints are provider specific; when a deployment sets
 * only the client credentials this adapter still builds a correct authorize
 * URL and fails loudly on exchange instead of silently creating a user.
 */

import { randomBytes } from "node:crypto";
import type {
  ConfigPort,
  SocialAuthorizeResult,
  SocialAuthProvider,
  SocialProfile,
} from "./auth-legacy/index.js";

/** Thrown when the provider has no credentials configured for this deployment. */
export class SocialLoginUnavailable extends Error {
  constructor(provider: string) {
    super(`社交登录未配置：${provider}`);
    this.name = "SocialLoginUnavailable";
  }
}

interface ProviderEndpoints {
  authorize: string;
  token: string;
  profile: string;
  scope: string;
}

const ENDPOINTS: Record<string, ProviderEndpoints> = {
  qq: {
    authorize: "https://graph.qq.com/oauth2.0/authorize",
    token: "https://graph.qq.com/oauth2.0/token",
    profile: "https://graph.qq.com/user/get_user_info",
    scope: "get_user_info",
  },
  wx: {
    authorize: "https://open.weixin.qq.com/connect/qrconnect",
    token: "https://api.weixin.qq.com/sns/oauth2/access_token",
    profile: "https://api.weixin.qq.com/sns/userinfo",
    scope: "snsapi_login",
  },
};

export class EnvSocialProvider implements SocialAuthProvider {
  constructor(
    private readonly config: ConfigPort,
    private readonly baseUrl: () => string = () => "",
  ) {}

  private settings(provider: string): { clientId: string; clientSecret: string; redirectUri: string; endpoints: ProviderEndpoints } {
    const key = provider.toUpperCase();
    const endpoints = ENDPOINTS[provider];
    if (endpoints === undefined) throw new SocialLoginUnavailable(provider);
    const clientId = this.config.get(`OAUTH_${key}_CLIENT_ID`);
    const clientSecret = this.config.get(`OAUTH_${key}_CLIENT_SECRET`);
    if (clientId === "" || clientSecret === "") throw new SocialLoginUnavailable(provider);
    const fallbackBase = this.baseUrl().replace(/\/+$/, "");
    const redirectUri =
      this.config.get(`OAUTH_${key}_REDIRECT_URI`) ||
      (fallbackBase === "" ? "" : `${fallbackBase}/auth/social/callback?provider=${provider}`);
    if (redirectUri === "") throw new SocialLoginUnavailable(provider);
    return { clientId, clientSecret, redirectUri, endpoints };
  }

  async authorizeUrl(provider: string, redirectAfter: string): Promise<SocialAuthorizeResult> {
    const { clientId, redirectUri, endpoints } = this.settings(provider);
    const state = randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: endpoints.scope,
    });
    if (provider === "wx") params.set("scope", endpoints.scope);
    if (provider === "qq" && redirectAfter !== "") params.set("state", `${state}`);
    const joiner = endpoints.authorize.includes("?") ? "&" : "?";
    return { url: `${endpoints.authorize}${joiner}${params.toString()}`, state };
  }

  async exchangeCode(provider: string, code: string): Promise<SocialProfile> {
    const { clientId, clientSecret, redirectUri, endpoints } = this.settings(provider);
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    const tokenResponse = await fetch(`${endpoints.token}?${tokenParams.toString()}`, {
      headers: { accept: "application/json" },
    });
    if (!tokenResponse.ok) throw new SocialLoginUnavailable(`${provider}: token exchange failed`);
    const tokenBody = (await tokenResponse.json()) as Record<string, unknown>;
    const accessToken = String(tokenBody["access_token"] ?? "");
    const openId = String(tokenBody["openid"] ?? "");
    if (accessToken === "") throw new SocialLoginUnavailable(`${provider}: missing access_token`);

    const profileParams = new URLSearchParams({ access_token: accessToken });
    if (openId !== "") profileParams.set("openid", openId);
    const profileResponse = await fetch(`${endpoints.profile}?${profileParams.toString()}`, {
      headers: { accept: "application/json" },
    });
    if (!profileResponse.ok) throw new SocialLoginUnavailable(`${provider}: profile request failed`);
    const profile = (await profileResponse.json()) as Record<string, unknown>;
    const identifier = openId !== "" ? openId : String(profile["unionid"] ?? profile["openid"] ?? "");
    if (identifier === "") throw new SocialLoginUnavailable(`${provider}: missing subject`);

    return {
      social_uid: identifier,
      nickname: String(profile["nickname"] ?? profile["screen_name"] ?? ""),
      avatar_url: String(profile["figureurl_qq_2"] ?? profile["headimgurl"] ?? ""),
      provider,
    };
  }
}
