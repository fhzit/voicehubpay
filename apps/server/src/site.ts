/**
 * Site-wide view data shared by every template (`site.*`).
 *
 * Mirrors the `$__site` array built by the PHP `Controller::render()`:
 *   - name            SITE_NAME
 *   - url             public base URL (SITE_BASE_URL / SITE_URL / APP_URL)
 *   - auth_login      effective login path   (honours AUTH_SECRET_PREFIX)
 *   - auth_register   effective register path
 *   - stat_code       raw SITE_STAT_CODE snippet injected into <head>
 *   - icp             ICP_BEIAN_NO footer line
 *
 * Templates must only use `site.*` for these values so a deployment can
 * rebrand without touching markup.
 */

/** Minimal config surface needed to build the site object. */
export interface SiteConfigPort {
  get(key: string, fallback?: string): string;
  /** Optional: PHP Config::authUrl() — applies AUTH_SECRET_PREFIX. */
  authUrl?(route: string): string;
}

export interface Site {
  name: string;
  url: string;
  auth_register: string;
  auth_login: string;
  stat_code: string;
  icp: string;
}

const DEFAULT_NAME = "VoiceHubPay";
const DEFAULT_REGISTER = "/auth/password/register";
const DEFAULT_LOGIN = "/login";

/** Build the `site` object injected into every rendered page. */
export function buildSite(config: SiteConfigPort): Site {
  const authUrl = typeof config.authUrl === "function" ? config.authUrl.bind(config) : (route: string) => route;
  const url = config.get("SITE_BASE_URL", config.get("SITE_URL", config.get("APP_URL", "")));
  return {
    name: config.get("SITE_NAME", DEFAULT_NAME) || DEFAULT_NAME,
    url: url.replace(/\/+$/, ""),
    auth_register: config.get("AUTH_REGISTER_PATH", authUrl(DEFAULT_REGISTER) || DEFAULT_REGISTER),
    auth_login: config.get("AUTH_LOGIN_PATH", authUrl(DEFAULT_LOGIN) || DEFAULT_LOGIN),
    stat_code: config.get("SITE_STAT_CODE", ""),
    icp: config.get("ICP_BEIAN_NO", ""),
  };
}
