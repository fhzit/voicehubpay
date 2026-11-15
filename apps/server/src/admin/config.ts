/**
 * File/env backed AdminConfigPort.
 *
 * Settings persist to `<basePath>/storage/settings.json` (same location as the
 * legacy `SettingsRepository`); environment variables provide defaults and
 * secrets. This is the adapter `index.ts` should pass as `deps.config`.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CryptoService } from "../../../../packages/db/src/index.js";
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
  private crypto: CryptoService | undefined;
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
    const stored = this.values[key];
    const value = stored !== undefined ? stored : this.env[key];
    if (value === undefined || value === "") return fallback;
    // Secrets migrated from PHP are `v1:` ciphertext; callers need plaintext.
    if (value.startsWith("v1:")) {
      if (this.crypto === undefined) this.crypto = new CryptoService(this.env.APP_BASE_PATH ?? process.env.APP_BASE_PATH ?? this.basePath);
      try {
        return this.crypto.decrypt(value);
      } catch {
        return value;
      }
    }
    return value;
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
    const parse = (raw: string): Record<string, string> => {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const output: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") output[key] = String(value);
      }
      return output;
    };
    try {
      return parse(readFileSync(this.file, "utf8"));
    } catch {
      // First boot on a fresh volume: fall back to a mounted seed (the migrated
      // PHP settings) so SMTP / Afdian / SG65 configuration is never lost.
      const seed = this.env.ADMIN_SETTINGS_SEED;
      if (seed === undefined || seed === "") return {};
      try {
        const values = parse(readFileSync(seed, "utf8"));
        try {
          mkdirSync(path.dirname(this.file), { recursive: true });
          writeFileSync(this.file, JSON.stringify(values, null, 2), "utf8");
        } catch {
          /* read-only volume: keep values in memory */
        }
        return values;
      } catch {
        return {};
      }
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
