/**
 * Deployment configuration check — replaces the PHP install wizard.
 *
 * The PHP build shipped a 7-step `/install` wizard that wrote
 * `storage/settings.sqlite`. This deployment is configured entirely through
 * environment variables (Kubernetes Secret), so the equivalent contract is:
 * validate the environment at boot, log a human-readable summary, and refuse to
 * start when the mandatory keys are missing instead of serving a half-working
 * shop.
 *
 * Set `ALLOW_EMPTY_DB=1` to boot without a database (useful for probing the
 * process, matching the previous behaviour that only logged a warning).
 */

export interface DeploymentEnvReport {
  ok: boolean;
  /** Variables that must be present for a usable shop. */
  missing: string[];
  /** Non-fatal problems worth surfacing at boot. */
  warnings: string[];
  /** Effective values (secrets masked) for the boot log. */
  summary: Record<string, string>;
}

const SECRET_KEYS = ["PRIVATE_KEY", "SECRET", "PASSWORD", "TOKEN", "API_KEY", "MASTER_KEY"];

function mask(key: string, value: string): string {
  if (value === "") return "(空)";
  const upper = key.toUpperCase();
  if (SECRET_KEYS.some((marker) => upper.includes(marker))) {
    return value.length <= 6 ? "***" : `${value.slice(0, 3)}***${value.slice(-2)}`;
  }
  return value;
}

/**
 * Inspect a process environment and return the deployment verdict.
 * Pure function — no logging, no side effects, easy to unit test.
 */
export function checkDeploymentEnv(env: NodeJS.ProcessEnv = process.env): DeploymentEnvReport {
  const missing: string[] = [];
  const warnings: string[] = [];

  const databaseUrl = env["DATABASE_URL"] ?? "";
  const databasePath = env["DATABASE_PATH"] ?? "";
  if (databaseUrl === "" && databasePath === "") {
    if (env["ALLOW_EMPTY_DB"] === "1") warnings.push("未配置数据库（ALLOW_EMPTY_DB=1），认证与商城功能不可用");
    else missing.push("DATABASE_URL 或 DATABASE_PATH");
  }

  const appUrl = env["APP_URL"] ?? "";
  if (appUrl === "") {
    if (env["NODE_ENV"] === "production") missing.push("APP_URL");
    else warnings.push("APP_URL 未设置，站点绝对链接与支付回调地址可能不正确");
  } else if (!/^https?:\/\//.test(appUrl)) {
    warnings.push("APP_URL 必须以 http:// 或 https:// 开头");
  }

  if (env["NODE_ENV"] === "production" && appUrl.startsWith("http://")) {
    warnings.push("生产环境 APP_URL 使用 http，支付回调与 Cookie 可能被浏览器拒绝");
  }

  const shopEnabled = ["1", "true", "yes", "on"].includes((env["SHOP_LEGACY_ENABLED"] ?? "").toLowerCase());
  if (shopEnabled) {
    if ((env["SG65_PID"] ?? "") === "") warnings.push("SHOP_LEGACY_ENABLED=1 但未配置 SG65_PID，支付下单会失败");
    if ((env["SG65_MERCHANT_PRIVATE_KEY"] ?? "") === "") warnings.push("未配置 SG65_MERCHANT_PRIVATE_KEY，无法发起支付");
  }

  const keyPath = env["APP_BASE_PATH"] ?? process.cwd();
  if (env["NODE_ENV"] === "production") {
    warnings.push(`主密钥目录：${keyPath}/storage/.masterkey（确保挂载且只读）`);
  }

  const summary: Record<string, string> = {};
  for (const key of [
    "NODE_ENV",
    "PORT",
    "APP_URL",
    "DATABASE_URL",
    "DATABASE_PATH",
    "SHOP_LEGACY_ENABLED",
    "SG65_PID",
    "AFDIAN_WEBHOOK_ENABLED",
    "SITE_NAME",
    "APP_BASE_PATH",
  ]) {
    const value = env[key] ?? "";
    if (value !== "") summary[key] = mask(key, value);
  }

  return { ok: missing.length === 0, missing, warnings, summary };
}

/** Render the report as a boot-time log block. */
export function formatDeploymentReport(report: DeploymentEnvReport): string {
  const lines = ["部署配置检查（env 驱动，无安装向导）"];
  for (const [key, value] of Object.entries(report.summary)) lines.push(`  ${key}=${value}`);
  for (const warning of report.warnings) lines.push(`  ⚠ ${warning}`);
  for (const item of report.missing) lines.push(`  ✖ 缺少 ${item}`);
  lines.push(report.ok ? "  ✔ 配置完整" : "  ✖ 配置不完整，进程退出");
  return lines.join("\n");
}
