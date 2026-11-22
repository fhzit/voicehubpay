/**
 * 数据库版设置存储：让后台配置在容器重建后依然存在。
 *
 * 为什么需要：K8s 里 `/data` 没有挂持久卷时是临时文件系统，每次滚动发布
 * settings.json 都会被清空——表现为「后台刚配好的通道/密钥，发一次版就没了」。
 * 这里把设置同时写进业务库的 app_settings 表，启动时回填，彻底摆脱对容器
 * 本地磁盘的依赖。
 */

import type { Database } from "../../../packages/db/src/index.js";

export interface SettingsStore {
  ensureSchema(): Promise<void>;
  loadAll(): Promise<Record<string, string>>;
  saveAll(values: Record<string, string>): Promise<void>;
}

export class DbSettingsStore implements SettingsStore {
  constructor(private readonly db: Database) {}

  async ensureSchema(): Promise<void> {
    const pk = this.db.dialect === "pgsql" ? "VARCHAR(128) PRIMARY KEY" : "TEXT PRIMARY KEY";
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS app_settings (key ${pk}, value TEXT NOT NULL DEFAULT '', updated_at VARCHAR(64) NOT NULL DEFAULT '')`,
    );
  }

  async loadAll(): Promise<Record<string, string>> {
    const rows = (await this.db.query<{ key: string; value: string }>("SELECT key, value FROM app_settings")).rows;
    const output: Record<string, string> = {};
    for (const row of rows) output[String(row.key)] = String(row.value ?? "");
    return output;
  }

  async saveAll(values: Record<string, string>): Promise<void> {
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(values)) {
      const result = await this.db.query("UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?", [value, now, key]);
      if (result.rowCount === 0) {
        // 并发插入冲突时忽略（另一进程已写入同一个键）。
        try {
          await this.db.query("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)", [key, value, now]);
        } catch {
          await this.db.query("UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?", [value, now, key]);
        }
      }
    }
  }
}
