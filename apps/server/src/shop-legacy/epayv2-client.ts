/**
 * 易支付 V2（RSA-SHA256 双向签名）客户端。
 *
 * 与 SG65 共用同一套签名实现（sg65-signer）：非空参数、剔除 sign/sign_type、
 * key ASCII 升序拼 `k=v&k=v`、商户私钥 SHA256WithRSA、Base64。差异只在
 * 网关地址与路径：
 *   POST {base}/api/pay/submit
 * 后台配置允许只填到 `.../xpay/epayn`，这里自动补 `/api/pay/submit`；
 * 若已经填了完整路径则原样使用。
 */

import type { Clock, ConfigPort, Sg65HttpPost } from "./types.js";
import { sign, verify } from "./sg65-signer.js";

const DEFAULT_BASE = "https://666.hboqy.cn/xpay/epayn";
const SUBMIT_PATH = "/api/pay/submit";

export class EpayV2Client {
  constructor(
    private readonly config: ConfigPort,
    private readonly clock: Clock,
    private readonly post: Sg65HttpPost,
  ) {}

  isEnabled(): boolean {
    return this.config.bool("EPAY_V2_ENABLED", false);
  }

  pid(): string {
    return this.config.get("EPAY_V2_PID", "");
  }

  merchantPrivateKey(): string {
    return this.config.get("EPAY_V2_MERCHANT_PRIVATE_KEY", "");
  }

  platformPublicKey(): string {
    return this.config.get("EPAY_V2_PLATFORM_PUBLIC_KEY", "");
  }

  /** 网关基地址（去掉尾部斜杠），空值回落到默认域名。 */
  baseUrl(): string {
    const raw = this.config.get("EPAY_V2_BASE_URL", DEFAULT_BASE).trim();
    const base = raw === "" ? DEFAULT_BASE : raw;
    return base.replace(/\/+$/, "");
  }

  /** 下单地址：未包含 /api/pay/submit 时自动补全。 */
  submitUrl(): string {
    const base = this.baseUrl();
    return base.endsWith(SUBMIT_PATH) ? base : `${base}${SUBMIT_PATH}`;
  }

  defaultPayType(): string {
    const t = this.config.get("EPAY_V2_DEFAULT_TYPE", "alipay");
    return ["alipay", "wxpay", "qqpay"].includes(t) ? t : "alipay";
  }

  enabledPayTypes(): string[] {
    const raw = this.config.get("EPAY_V2_ENABLED_TYPES", "alipay,wxpay");
    const allowed = ["alipay", "wxpay", "qqpay"] as const;
    const types = raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
    return allowed.filter((entry) => types.includes(entry));
  }

  isPayTypeEnabled(type: string): boolean {
    return this.enabledPayTypes().includes(type);
  }

  /** 统一下单，返回网关原始 JSON。 */
  async create(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const signed = this.signedParams(params);
    const body = Object.entries(signed)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    const response = await this.post(this.submitUrl(), body);
    let decoded: unknown;
    try {
      decoded = JSON.parse(response.text);
    } catch {
      throw new Error(`易支付返回非 JSON（HTTP ${response.status}）`);
    }
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw new Error(`易支付返回非 JSON（HTTP ${response.status}）`);
    }
    return decoded as Record<string, unknown>;
  }

  /** 补齐 pid / timestamp / sign_type 并签名。 */
  signedParams(params: Record<string, unknown>): Record<string, string> {
    const payload: Record<string, unknown> = {
      ...params,
      pid: this.pid(),
      timestamp: String(this.clock.now()),
      sign_type: "RSA",
    };
    const key = this.merchantPrivateKey();
    if (key === "") throw new Error("易支付商户私钥未配置。");
    payload["sign"] = sign(payload, key);
    const output: Record<string, string> = {};
    for (const [name, value] of Object.entries(payload)) {
      if (value === null || value === undefined) continue;
      output[name] = String(value);
    }
    return output;
  }

  /** 用平台公钥校验回调/返回签名。 */
  verifySignature(params: Record<string, unknown>): boolean {
    const key = this.platformPublicKey();
    if (key === "") return false;
    return verify(params, key);
  }
}
