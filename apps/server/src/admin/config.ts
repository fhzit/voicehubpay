/**
 * File/env backed AdminConfigPort.
 *
 * Settings persist to `<basePath>/storage/settings.json` (same location as the
 * legacy `SettingsRepository`); environment variables provide defaults and
 * secrets. This is the adapter `index.ts` should pass as `deps.config`.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AdminConfigPort, AdminSettingsPort } from "./types.js";

const SECRET_KEYS = new Set([
  "SMTP_PASSWORD",
  "SG65_MERCHANT_PRIVATE_KEY",
  "SG65_PLATFORM_PUBLIC_KEY",
  "VOICEHUB_API_TOKEN",
  "AFDIAN_API_TOKEN",
  "AGGREGATE_OAUTH_APP_KEY",
  "APP_MASTER_KEY",
]);

export class FileAdminConfig implements AdminConfigPort {
  readonly settings: AdminSettingsPort;
  private values: Record<string, string>;
  private readonly file: string;

  constructor(private readonly basePath: string, private readonly env: NodeJS.ProcessEnv = process.env) {
    this.file = path.join(basePath, "storage", "settings.json");
    this.values = this.read();
    this.settings = {
      all: () => ({ ...this.values }),
      saveMany: (next: Record<string, string>) => {
        this.values = { ...this.values, ...next };
        this.write();
      },
      remove: (keys: readonly string[]) => {
        const next = { ...this.values };
        for (const key of keys) delete next[key];
        this.values = next;
        this.write();
      },
    };
  }

  get(key: string, fallback = ""): string {
    const value = this.values[key] ?? this.env[key];
    return value === undefined || value === "" ? fallback : value;
  }

  bool(key: string, fallback: boolean): boolean {
    const value = this.get(key, "");
    if (value === "") return fallback;
    const normalised = value.trim().toLowerCase();
    return normalised === "1" || normalised === "true" || normalised === "yes" || normalised === "on";
  }

  int(key: string, fallback: number): number {
    const parsed = Number.parseInt(this.get(key, ""), 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  authUrl(route: string): string {
    const prefix = this.get("AUTH_SECRET_PREFIX", "").trim();
    if (prefix === "" || prefix === "/") return route;
    const normalised = `/${prefix}`.replace(/\/+/g, "/").replace(/\/+$/, "");
    return normalised === "" || normalised === "/" ? route : normalised + route;
  }

  appUrl(): string {
    return this.get("SITE_URL", this.get("APP_URL", "")).replace(/\/+$/, "");
  }

  secret(key: string, fallback = ""): string {
    return this.get(key, fallback);
  }

  setSecret(key: string, value: string): void {
    if (!SECRET_KEYS.has(key)) return;
    this.values[key] = value;
    this.write();
  }

  reloadSettings(): void {
    this.values = this.read();
  }

  private read(): Record<string, string> {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const output: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") output[key] = String(value);
      }
      return output;
    } catch {
      return {};
    }
  }

  private write(): void {
    const dir = path.dirname(this.file);
    mkdirSync(dir, { recursive: true, mode: 0o775 });
    writeFileSync(this.file, JSON.stringify(this.values, null, 2), { mode: 0o600 });
    try {
      chmodSync(this.file, 0o600);
    } catch {
      /* best effort */
    }
  }
}
