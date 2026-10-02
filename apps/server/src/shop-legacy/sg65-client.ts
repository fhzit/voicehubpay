import { sign } from "./sg65-signer.js";
import type { Clock, ConfigPort, Sg65HttpPost } from "./types.js";

/**
 * Port of VoiceHubPay\Payments\Sg65Client (SG65 V2 HTTP client:
 * form-encoded requests, JSON responses, UTF-8).
 *
 * External HTTP lives behind the injectable `post` transport so tests stay
 * deterministic and never touch the network.
 */
export class Sg65Client {
  static readonly BASE_URL = "https://bbs.sg65.cn";

  constructor(
    private readonly config: ConfigPort,
    private readonly clock: Clock,
    private readonly post: Sg65HttpPost,
  ) {}

  isEnabled(): boolean {
    return this.config.bool("SG65_ENABLED", false);
  }

  pid(): string {
    return this.config.get("SG65_PID", "");
  }

  merchantPrivateKey(): string {
    return this.config.get("SG65_MERCHANT_PRIVATE_KEY", "");
  }

  platformPublicKey(): string {
    return this.config.get("SG65_PLATFORM_PUBLIC_KEY", "");
  }

  defaultPayType(): string {
    const t = this.config.get("SG65_DEFAULT_PAYMENT_TYPE", "alipay");
    return ["alipay", "wxpay", "qqpay"].includes(t) ? t : "alipay";
  }

  enabledPayTypes(): string[] {
    const raw = this.config.get("SG65_ENABLED_TYPES", "alipay,wxpay,qqpay");
    const allowed = ["alipay", "wxpay", "qqpay"] as const;
    const types = raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    const intersection = allowed.filter((a) => types.includes(a));
    return intersection;
  }

  isPayTypeEnabled(type: string): boolean {
    return this.enabledPayTypes().includes(type);
  }

  /** 统一下单 /api/pay/create (method=jump recommended). */
  create(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.postJson("/api/pay/create", params);
  }

  /** 主动查单 /api/pay/query (by trade_no or out_trade_no). */
  query(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.postJson("/api/pay/query", params);
  }

  /** 商户信息 /api/merchant/info (used by test connection). */
  merchantInfo(): Promise<Record<string, unknown>> {
    return this.postJson("/api/merchant/info", {});
  }

  /** 商户订单 /api/merchant/orders (对账). */
  merchantOrders(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.postJson("/api/merchant/orders", params);
  }

  /** Build the full signed param set for a request. */
  signedParams(params: Record<string, unknown>): Record<string, string> {
    const withPid: Record<string, unknown> = { ...params, pid: this.pid(), timestamp: String(this.clock.now()) };
    withPid["sign_type"] = "RSA";
    withPid["sign"] = sign(withPid, this.merchantPrivateKey());
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(withPid)) {
      if (value === null || value === undefined) continue;
      output[key] = String(value);
    }
    return output;
  }

  private async postJson(path: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = formEncode(this.signedParams(params));
    const response = await this.post(path, body);
    let decoded: unknown;
    try {
      decoded = JSON.parse(response.text);
    } catch {
      throw new Error(`SG65 返回非 JSON（HTTP ${response.status}）`);
    }
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw new Error(`SG65 返回非 JSON（HTTP ${response.status}）`);
    }
    return decoded as Record<string, unknown>;
  }
}

/** http_build_query equivalent for flat string maps (RFC 1738-ish encoding). */
export function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}
