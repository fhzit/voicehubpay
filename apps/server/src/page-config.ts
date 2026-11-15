/**
 * Config adapter bridging the shop-side env config to the auth-side
 * `ConfigPort` contract (which additionally exposes `int()` and `authUrl()`).
 *
 * `authUrl()` mirrors the PHP `Config::authUrl()` behaviour: it prefixes the
 * route with an optional secret entry path so a deployment can hide the auth
 * pages behind `AUTH_PATH_PREFIX` (empty by default → `/login` etc.).
 */

import type { ConfigPort } from "./auth-legacy/types.js";
import { EnvShopConfig } from "./shop-legacy/shop-config.js";
import { CryptoService } from "../../../packages/db/src/index.js";

export class PageConfig extends EnvShopConfig implements ConfigPort {
  /** Secrets migrated from PHP are stored as `v1:` ciphertext — decrypt on read. */
  private readonly crypto = new CryptoService(process.env.APP_BASE_PATH ?? process.cwd());

  get(key: string, fallback = ""): string {
    const raw = super.get(key, fallback);
    if (typeof raw !== "string" || !raw.startsWith("v1:")) return raw;
    try {
      return this.crypto.decrypt(raw);
    } catch {
      return raw;
    }
  }

  int(key: string, fallback: number): number {
    const raw = this.get(key, "");
    if (raw === "") return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  authUrl(route: string): string {
    const prefix = this.get("AUTH_PATH_PREFIX", "").trim().replace(/^\/+|\/+$/g, "");
    const suffix = route.startsWith("/") ? route : `/${route}`;
    return prefix === "" ? suffix : `/${prefix}${suffix}`;
  }
}
