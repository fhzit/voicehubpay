import type { ConfigPort } from "./types.js";
import { CryptoService } from "../../../../packages/db/src/index.js";

/**
 * Environment-backed ConfigPort for the shop-legacy module (the deployment
 * counterpart of the PHP settings/env config). All SG65 keys are read from
 * the process environment; values mirror the PHP config surface:
 *
 *   SG65_ENABLED            "1"/"true"  — master payment switch
 *   SG65_PID                merchant id
 *   SG65_MERCHANT_PRIVATE_KEY  PEM or bare base64 (PKCS#8/PKCS#1)
 *   SG65_PLATFORM_PUBLIC_KEY   PEM or bare base64 (SPKI/PKCS#1)
 *   SG65_DEFAULT_PAYMENT_TYPE  alipay|wxpay|qqpay (default alipay)
 *   SG65_ENABLED_TYPES         comma list (default "alipay,wxpay,qqpay")
 *   SG65_DEFAULT_METHOD         jump (default)
 *   APP_URL / SITE_URL         public base URL for notify/return URLs
 *   ORDER_TTL_MINUTES          unpaid-order TTL (min 5, default 30)
 */
export class EnvShopConfig implements ConfigPort {
  private crypto: CryptoService | undefined;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  /**
   * Secrets migrated from the PHP panel are stored as `v1:<base64>` ciphertext
   * (SG65 keys, Afdian/VoiceHub tokens, SMTP password). Every consumer expects
   * plaintext, so decrypt on read with the shared master key.
   */
  private decryptIfNeeded(value: string): string {
    if (!value.startsWith("v1:")) return value;
    if (this.crypto === undefined) {
      this.crypto = new CryptoService(this.env.APP_BASE_PATH ?? process.env.APP_BASE_PATH ?? process.cwd());
    }
    try {
      return this.crypto.decrypt(value);
    } catch {
      return value;
    }
  }

  get(key: string, fallback = ""): string {
    const value = this.env[key];
    if (value === undefined || value === "") return fallback;
    return this.decryptIfNeeded(value);
  }

  bool(key: string, fallback: boolean): boolean {
    const value = this.env[key];
    if (value === undefined || value === "") return fallback;
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }

  int(key: string, fallback: number): number {
    const parsed = Number.parseInt(this.get(key, ""), 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  /** PHP Config::appUrl() — rtrim(SITE_URL or APP_URL). */
  appUrl(): string {
    return this.get("SITE_URL", this.get("APP_URL", "")).replace(/\/+$/, "");
  }
}
