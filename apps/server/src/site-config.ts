/**
 * 站点共享配置：后台保存的 settings.json 优先，环境变量兜底。
 *
 * 关键点：后台（admin）与前台（收银台/支付/爱发电）必须读**同一个实例**，
 * 否则后台改了通道开关、展示名称、手续费，前台看不到（此前前台只读环境变量，
 * 于是出现“后台已启用两个通道、收银台却没有通道选择”）。
 */

import type { ConfigPort } from "./shop-legacy/types.js";
import { FileAdminConfig } from "./admin/config.js";
import type { SettingsStore } from "./settings-db.js";

export class SiteConfig implements ConfigPort {
  constructor(readonly file: FileAdminConfig) {}

  get(key: string, fallback = ""): string {
    return this.file.get(key, fallback);
  }

  bool(key: string, fallback: boolean): boolean {
    return this.file.bool(key, fallback);
  }

  int(key: string, fallback: number): number {
    return this.file.int(key, fallback);
  }

  /** 站点根地址（后台「基础设置」写入 SITE_URL）。 */
  appUrl(): string {
    return this.file.appUrl();
  }

  /** 登录/注册安全路径：兼容历史 AUTH_PATH_PREFIX 与现行 AUTH_SECRET_PREFIX。 */
  authUrl(route: string): string {
    const raw = this.get("AUTH_SECRET_PREFIX", "") || this.get("AUTH_PATH_PREFIX", "");
    const prefix = raw.trim().replace(/^\/+|\/+$/g, "");
    const suffix = route.startsWith("/") ? route : `/${route}`;
    if (prefix === "" || prefix === "/") return suffix;
    return `/${prefix}${suffix}`;
  }

  // ---- AdminConfigPort 透传（后台与前台共用同一份内存/文件状态）
  get settings(): FileAdminConfig["settings"] {
    return this.file.settings;
  }

  secret(key: string, fallback = ""): string {
    return this.file.secret(key, fallback);
  }

  setSecret(key: string, value: string): void {
    this.file.setSecret(key, value);
  }

  reloadSettings(): void {
    this.file.reloadSettings();
  }

  /** 从数据库恢复设置（容器重建后不丢配置）。 */
  async hydrate(): Promise<void> {
    await this.file.hydrate();
  }

  /** 立即落库（测试/优雅关闭用）。 */
  async persist(): Promise<void> {
    await this.file.persist();
  }
}

/** 按部署约定构造共享站点配置（默认 /data，可用 ADMIN_DATA_DIR 覆盖）。 */
export function createSiteConfig(env: NodeJS.ProcessEnv = process.env, remote?: SettingsStore): SiteConfig {
  const basePath = env.ADMIN_DATA_DIR ?? "/data";
  return new SiteConfig(new FileAdminConfig(basePath, env, remote));
}
