#!/usr/bin/env node
/**
 * Export the PHP settings store into TypeScript environment variables.
 *
 * The TS build is env-driven by design: it must never open `storage/settings.sqlite`
 * at runtime (the file also holds the master key material). This script performs
 * a one-off, deploy-time translation so the same values can be written into a
 * Kubernetes Secret / .env file.
 *
 *   node scripts/export-ts-env.mjs <settings.sqlite> [--json|--dotenv] [--out FILE]
 *
 * Output is JSON by default (values keep real newlines, which Kubernetes Secret
 * literals accept). `--dotenv` escapes newlines as \n for `.env` loaders.
 *
 * Secret values are never printed: the script reports key names, lengths and a
 * sha256 of the whole result so an operator can verify the import without
 * exposing credentials.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

/** settings.sqlite key -> TypeScript env var (identity unless stated). */
const DIRECT = [
  "APP_URL",
  "SITE_NAME",
  "SITE_URL",
  "ICP_BEIAN_NO",
  "SITE_STAT_CODE",
  "APP_TIMEZONE",
  "ORDER_TTL_MINUTES",
  "PAGE_SIZE",
  "HOT_SERVICES_ENABLED",
  "SG65_PID",
  "SG65_ENABLED",
  "SG65_ENABLED_TYPES",
  "SG65_DEFAULT_METHOD",
  "SG65_DEFAULT_PAYMENT_TYPE",
  "SG65_MERCHANT_PRIVATE_KEY",
  "SG65_PLATFORM_PUBLIC_KEY",
  "VOICEHUB_ENABLED",
  "VOICEHUB_API_BASE",
  "VOICEHUB_API_TOKEN",
  "VOICEHUB_TICKET_ENDPOINT",
  "VOICEHUB_RETRIES",
  "VOICEHUB_TIMEOUT",
  "AFDIAN_ENABLED",
  "AFDIAN_API_BASE",
  "AFDIAN_API_TOKEN",
  "AFDIAN_USER_ID",
  "AFDIAN_ORDER_ENDPOINT",
  "AFDIAN_WEBHOOK_REQUIRE_SIGNATURE",
  "AFDIAN_FEE_PERCENT",
  "AFDIAN_POLL_LIMIT",
  "AFDIAN_POLL_PER_PAGE",
  "AGGREGATE_OAUTH_APP_ID",
  "AGGREGATE_OAUTH_APP_KEY",
  "AGGREGATE_OAUTH_ENDPOINT",
  "QQ_LOGIN_ENABLED",
  "WX_LOGIN_ENABLED",
  "REGISTRATION_ENABLED",
  "SMTP_ENABLED",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_ENCRYPTION",
  "SMTP_FROM",
  "SMTP_FROM_NAME",
  "NOTIFY_EMAIL",
];

/** Keys the TS process needs but that live in different PHP rows. */
function derived(settings, env) {
  const user = settings.get("DATA_DB_USERNAME") ?? "";
  const pass = settings.get("DATA_DB_PASSWORD") ?? "";
  const host = settings.get("DATA_DB_HOST") ?? "";
  const port = settings.get("DATA_DB_PORT") ?? "5432";
  const database = settings.get("DATA_DB_DATABASE") ?? "";
  const connection = (settings.get("DATA_DB_CONNECTION") ?? "").toLowerCase();
  if (connection === "pgsql" && host !== "" && database !== "") {
    env["DATABASE_URL"] = `postgres://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${database}`;
  }
  env["SHOP_LEGACY_ENABLED"] = "1";
  env["NODE_ENV"] = "production";
  env["APP_BASE_PATH"] = "/legacy/vhpay/index";
  // PHP stores the site's absolute URL; the TS site builder reads SITE_BASE_URL.
  if (env["SITE_URL"]) env["SITE_BASE_URL"] = env["SITE_URL"];
  if (env["APP_TIMEZONE"]) env["TZ"] = env["APP_TIMEZONE"];
}

function readSettings(path) {
  // better-sqlite3 ships with the workspace, so the export runs anywhere the
  // server itself can run — no sqlite3 CLI required.
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare("SELECT key, value FROM app_settings").all();
    const map = new Map();
    for (const row of rows) map.set(String(row.key), String(row.value ?? ""));
    return map;
  } finally {
    db.close();
  }
}

function main() {
  const args = process.argv.slice(2);
  const settingsPath = args.find((a) => !a.startsWith("--"));
  if (!settingsPath) {
    console.error("usage: node scripts/export-ts-env.mjs <settings.sqlite> [--json|--dotenv] [--out FILE]");
    process.exit(1);
  }
  const dotenv = args.includes("--dotenv");
  const outIndex = args.indexOf("--out");
  const outFile = outIndex >= 0 ? args[outIndex + 1] : null;

  const settings = readSettings(settingsPath);
  const env = {};
  for (const key of DIRECT) {
    const value = settings.get(key);
    if (value !== undefined && value !== "") env[key] = value;
  }
  derived(settings, env);

  const payload = dotenv
    ? Object.entries(env)
        .map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"')}"`)
        .join("\n") + "\n"
    : JSON.stringify(env, null, 2) + "\n";

  const sha = createHash("sha256").update(payload).digest("hex");
  if (outFile) writeFileSync(outFile, payload, { mode: 0o600 });

  console.log(`导出 ${Object.keys(env).length} 个环境变量${outFile ? ` -> ${outFile}` : ""}`);
  for (const [key, value] of Object.entries(env)) {
    const masked = /KEY|TOKEN|PASSWORD|PRIVATE|DATABASE_URL|SECRET/.test(key);
    const shown = masked ? `len=${String(value).length}` : String(value).slice(0, 48);
    console.log(`  ${key.padEnd(30)} ${shown}`);
  }
  console.log(`sha256(payload)=${sha}`);
}

main();
