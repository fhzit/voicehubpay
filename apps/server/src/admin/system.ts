/**
 * `/admin/system/database` — database info, health check, analytics rebuild
 * (port of Admin\SystemController).
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { AdminRouter } from "./router.js";
import type { Row } from "./types.js";

const REQUIRED_TABLES = [
  "users",
  "social_identities",
  "categories",
  "products",
  "inventory_cards",
  "orders",
  "order_items",
  "fulfillment_units",
  "voicehub_deliveries",
  "payment_transactions",
  "afdian_orders",
  "audit_logs",
];

export function registerSystemRoutes(router: AdminRouter): void {
  const deps = router.deps;

  router.get("/admin/system/database", async (context) => {
    const dialect = deps.db?.dialect ?? "sqlite";
    const describe = {
      type: dialect === "pgsql" ? "PostgreSQL" : "SQLite",
      dsn: dialect === "pgsql" ? deps.config.get("DATABASE_URL", "") : deps.config.get("DATABASE_PATH", ""),
    };
    const dbPath = deps.config.get("DATABASE_PATH", "");
    let dbSize: number | null = null;
    if (dialect === "sqlite" && dbPath !== "" && dbPath !== ":memory:") {
      try {
        dbSize = (await stat(dbPath)).size;
      } catch {
        dbSize = null;
      }
    }

    const appliedRaw = deps.config.get("SCHEMA_APPLIED", "");
    const applied = appliedRaw === "" ? [] : appliedRaw.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");

    return context.render("system/database", {
      pageTitle: "数据库",
      nav: "system",
      describe,
      db_size: dbSize,
      schema_version: deps.config.get("SCHEMA_VERSION", "—"),
      applied,
      installed_at: deps.config.get("INSTALLED_AT", "") || null,
      last_migration: deps.config.get("SCHEMA_VERSION", "") || null,
      analytics_last_rebuild: deps.config.get("ANALYTICS_LAST_REBUILD", "") || null,
      backups: await listBackups(basePath(deps)),
    });
  });

  router.post("/admin/system/database/check", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    if (deps.db === undefined) return context.json({ ok: false, error: "数据库连接未配置。" }, 500);
    const checks: Record<string, string> = {};
    for (const table of REQUIRED_TABLES) {
      try {
        await deps.db.query(`SELECT COUNT(*) FROM ${table}`);
        checks[table] = "ok";
      } catch {
        checks[table] = "missing";
      }
    }
    await context.audit("database.check", "database", "tables", checks);
    return context.json({ ok: true, tables: checks });
  });

  router.post("/admin/system/analytics/rebuild", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    // No analytics service is wired in this build; keep the route honest.
    return context.redirect("/admin/system/database", "Analytics 重建服务未配置。", "error");
  });
}

function basePath(deps: AdminRouter["deps"]): string {
  return deps.config.get("APP_BASE_PATH", process.cwd());
}

async function listBackups(root: string): Promise<Row[]> {
  const dir = path.join(root, "storage", "backups");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const backups: Row[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    try {
      const info = await stat(full);
      if (!info.isDirectory()) continue;
      const files = await readdir(full).catch(() => []);
      backups.push({ name: entry, mtime: info.mtime.toISOString().replace(/\.\d{3}Z$/, "+00:00"), files: files.length });
    } catch {
      continue;
    }
  }
  backups.sort((a, b) => String(b["name"]).localeCompare(String(a["name"])));
  return backups.slice(0, 20);
}
