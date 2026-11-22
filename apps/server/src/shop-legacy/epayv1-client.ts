/**
 * 易支付 V1（页面支付 / submit.php，MD5 签名）客户端。
 *
 * 与 V2（RSA-SHA256 + JSON）并存，互不影响：
 *   POST/GET {base}/submit.php  pid,type,out_trade_no,notify_url,return_url,name,money,sign
 *
 * 签名规则（易支付通用）：
 *   1. 取所有非空参数，剔除 sign / sign_type；
 *   2. 按参数名 ASCII 升序拼成 `k=v&k=v`；
 *   3. 末尾直接拼接商户密钥（无分隔符），MD5 后按 EPAY_V1_SIGN_CASE 决定大小写。
 *
 * 大小写：彩虹易支付系（submit.php 页面支付）默认 **小写** MD5；少数魔改网关要求
 * 大写。默认输出小写，可用 EPAY_V1_SIGN_CASE=upper 切换。
 *
 * 后台只填到 `.../xpay/epay`（或 `.../xpay`）时自动补全 `/epay/submit.php`。
 */

import { createHash } from "node:crypto";
import type { ConfigPort } from "./types.js";

const DEFAULT_BASE = "https://666.hboqy.cn/xpay/epay";
const SUBMIT_FILE = "/epay/submit.php";
const ALLOWED_TYPES = ["alipay", "wxpay", "qqpay"] as const;

export class EpayV1Client {
  constructor(private readonly config: ConfigPort) {}

  isEnabled(): boolean {
    return this.config.bool("EPAY_V1_ENABLED", false);
  }

  pid(): string {
    return this.config.get("EPAY_V1_PID", "");
  }

  /** 商户 MD5 密钥（易支付后台「商户密钥」）。 */
  merchantKey(): string {
    return this.config.get("EPAY_V1_KEY", "");
  }

  baseUrl(): string {
    const raw = this.config.get("EPAY_V1_BASE_URL", DEFAULT_BASE).trim();
    return (raw === "" ? DEFAULT_BASE : raw).replace(/\/+$/, "");
  }

  /** 下单地址：容忍只填到 /xpay、/xpay/epay 或完整 submit.php。 */
  submitUrl(): string {
    const base = this.baseUrl();
    if (base.endsWith("/submit.php")) return base;
    if (base.endsWith("/epay")) return `${base}/submit.php`;
    return `${base}${SUBMIT_FILE}`;
  }

  defaultPayType(): string {
    const type = this.config.get("EPAY_V1_DEFAULT_TYPE", "alipay");
    return (ALLOWED_TYPES as readonly string[]).includes(type) ? type : "alipay";
  }

  enabledPayTypes(): string[] {
    const raw = this.config.get("EPAY_V1_ENABLED_TYPES", "alipay,wxpay");
    const listed = raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
    return ALLOWED_TYPES.filter((type) => listed.includes(type));
  }

  isPayTypeEnabled(type: string): boolean {
    return this.enabledPayTypes().includes(type);
  }

  /** 计算签名（MD5；默认小写，可用 EPAY_V1_SIGN_CASE=upper 切换）。 */
  signParams(params: Record<string, unknown>): string {
    const key = this.merchantKey();
    if (key === "") throw new Error("易支付V1 商户密钥未配置。");
    const pairs: string[] = [];
    for (const name of Object.keys(params).sort()) {
      if (name === "sign" || name === "sign_type") continue;
      const value = params[name];
      if (value === null || value === undefined || value === "") continue;
      pairs.push(`${name}=${String(value)}`);
    }
    const digest = createHash("md5").update(`${pairs.join("&")}${key}`, "utf8").digest("hex");
    return this.signCaseUpperCase() ? digest.toUpperCase() : digest;
  }

  /** 网关要求大写 MD5 时可用 EPAY_V1_SIGN_CASE=upper 开启（默认小写）。 */
  private signCaseUpperCase(): boolean {
    return this.config.get("EPAY_V1_SIGN_CASE", "lower").trim().toLowerCase() === "upper";
  }

  /**
   * 待签名字符串（ASCII 升序、剔除 sign/sign_type 与空值、末尾拼密钥）。
   * 不含密钥部分可用于后台自检对比，切勿整体泄露。
   */
  signingString(params: Record<string, unknown>): string {
    const pairs: string[] = [];
    for (const name of Object.keys(params).sort()) {
      if (name === "sign" || name === "sign_type") continue;
      const value = params[name];
      if (value === null || value === undefined || value === "") continue;
      pairs.push(`${name}=${String(value)}`);
    }
    return pairs.join("&");
  }

  /**
   * 生成已签名的表单字段（含 pid/sign/sign_type）。
   * 官方文档要求「表单提交方式」，因此支付页用这些字段 POST 到 submitUrl()。
   */
  payParams(params: Record<string, unknown>): Record<string, string> {
    const payload: Record<string, string> = { pid: this.pid() };
    for (const [name, value] of Object.entries(params)) {
      if (value === null || value === undefined || value === "") continue;
      payload[name] = String(value);
    }
    payload["sign"] = this.signParams(payload);
    payload["sign_type"] = "MD5";
    return payload;
  }

  /** 带签名参数的 GET 地址（部分网关接受；主要用 payParams 做表单提交）。 */
  payUrl(params: Record<string, unknown>): string {
    const query = Object.entries(this.payParams(params))
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      .join("&");
    return `${this.submitUrl()}?${query}`;
  }

  /** 回调验签：重算 MD5 并做大小写不敏感比较。 */
  verifySignature(params: Record<string, unknown>): boolean {
    const provided = typeof params["sign"] === "string" ? params["sign"].trim() : "";
    if (provided === "") return false;
    let expected: string;
    try {
      expected = this.signParams(params);
    } catch {
      return false;
    }
    return expected.toLowerCase() === provided.toLowerCase();
  }
}
