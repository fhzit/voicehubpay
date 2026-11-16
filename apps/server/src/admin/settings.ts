/**
 * `/admin/settings/*` — general, payment, auth, VoiceHub, Afdian, SMTP and
 * security settings (port of Admin\SettingsController).
 *
 * Settings persist through `config.settings` (all/saveMany); secrets through
 * `config.setSecret`. When those seams are absent the pages render read-only
 * and saves answer with an explanatory flash.
 */

import type { AdminContext, AdminRouter } from "./router.js";
import { formBool, formFloat, formInt, formList, formString, formTrimmed } from "./router.js";
import type { AdminConfigPort, Row } from "./types.js";


/** 易支付V2 下单地址：后台只填到 /xpay/epayn 时自动补 /api/pay/submit。 */
function epaySubmitUrl(config: AdminConfigPort): string {
  const raw = (config.get("EPAY_V2_BASE_URL", "https://666.hboqy.cn/xpay/epayn") || "").trim();
  const base = (raw === "" ? "https://666.hboqy.cn/xpay/epayn" : raw).replace(/\/+$/, "");
  return base.endsWith("/api/pay/submit") ? base : `${base}/api/pay/submit`;
}

const TIMEZONES = ["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Taipei", "Asia/Tokyo", "Asia/Singapore", "UTC", "America/Los_Angeles", "Europe/London"];
const MASK = "••••••••";

export function registerSettingsRoutes(router: AdminRouter): void {
  const deps = router.deps;
  const config = deps.config;

  // ------------------------------------------------------------- general
  router.get("/admin/settings/general", async (context) =>
    context.render("settings/general", {
      pageTitle: "基础设置",
      nav: "settings_general",
      settings: readSettings(config),
      timezones: TIMEZONES,
    }),
  );

  router.post("/admin/settings/general", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const body = context.body;
    const siteName = formTrimmed(body, "site_name");
    const siteUrl = formTrimmed(body, "site_url");
    if (siteName === "" || siteUrl === "") return context.redirect("/admin/settings/general", "站点名称和 URL 不能为空。", "error");
    if (!isHttpBaseUrl(siteUrl)) {
      return context.redirect("/admin/settings/general", "站点 URL 必须是无账号、查询参数和片段的 HTTP(S) 根地址。", "error");
    }
    const timezone = formString(body, "timezone", "Asia/Shanghai");
    if (!validTimezone(timezone)) return context.redirect("/admin/settings/general", "无效的时区。", "error");

    const authRedirectUrl = formTrimmed(body, "auth_redirect_url");
    if (authRedirectUrl !== "" && !isHttpBaseUrl(authRedirectUrl)) {
      return context.redirect("/admin/settings/general", "访客重定向地址必须是无账号、查询参数和片段的 HTTP(S) 根地址，或留空。", "error");
    }
    const authSecretPrefix = normalizeAuthPrefix(formString(body, "auth_secret_prefix"));
    if (authSecretPrefix === null) {
      return context.redirect("/admin/settings/general", "登录/注册访问安全路径必须是形如 /secret 的路径，不能包含协议、查询参数、井号或空白字符。", "error");
    }

    const normalizedUrl = siteUrl.replace(/\/+$/, "");
    const saved = await saveSettings(router, context, {
      SITE_NAME: siteName,
      SITE_URL: normalizedUrl,
      APP_URL: normalizedUrl,
      SITE_LOGO: formString(body, "site_logo"),
      APP_TIMEZONE: timezone,
      REGISTRATION_ENABLED: formBool(body, "registration") ? "1" : "0",
      ORDER_TTL_MINUTES: String(Math.max(5, formInt(body, "order_ttl", 30))),
      PAGE_SIZE: String(Math.max(5, formInt(body, "page_size", 20))),
      AUTH_REDIRECT_URL: authRedirectUrl,
      AUTH_SECRET_PREFIX: authSecretPrefix,
      ICP_BEIAN_NO: formTrimmed(body, "icp_beian_no"),
      SITE_STAT_CODE: formTrimmed(body, "site_stat_code"),
      HOT_SERVICES_ENABLED: formBool(body, "show_hot") ? "1" : "0",
    });
    if (!saved) return context.reply;
    await context.audit("settings.general", "settings", "general", { site: siteName });
    return context.redirect("/admin/settings/general", "基础设置已保存。");
  });

  // ---------------------------------------------------------------- smtp
  router.get("/admin/settings/smtp", async (context) =>
    context.render("settings/smtp", {
      pageTitle: "邮件设置",
      nav: "settings_smtp",
      settings: readSettings(config),
      password_placeholder: secretConfigured(config, "SMTP_PASSWORD") ? "已配置，留空表示不修改。" : "",
    }),
  );

  router.post("/admin/settings/smtp", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const body = context.body;
    const host = formTrimmed(body, "smtp_host");
    const port = Math.max(1, formInt(body, "smtp_port", 587));
    const from = formTrimmed(body, "smtp_from");
    const enabled = formBool(body, "smtp_enabled");
    if (enabled && (host === "" || from === "")) {
      return context.redirect("/admin/settings/smtp", "启用 SMTP 时，服务器和发件人邮箱不能为空。", "error");
    }
    if (!isEmail(from)) return context.redirect("/admin/settings/smtp", "发件人邮箱格式不正确。", "error");
    const notify = formTrimmed(body, "notify_email");
    if (notify !== "" && !isEmail(notify)) return context.redirect("/admin/settings/smtp", "管理员通知邮箱格式不正确。", "error");

    const saved = await saveSettings(router, context, {
      SMTP_ENABLED: enabled ? "1" : "0",
      SMTP_HOST: host,
      SMTP_PORT: String(port),
      SMTP_ENCRYPTION: formTrimmed(body, "smtp_encryption"),
      SMTP_USERNAME: formTrimmed(body, "smtp_username"),
      SMTP_FROM: from,
      SMTP_FROM_NAME: formTrimmed(body, "smtp_from_name"),
      NOTIFY_EMAIL: notify,
    });
    if (!saved) return context.reply;
    await maybeSaveSecret(router, "SMTP_PASSWORD", formString(body, "smtp_password"), "••••");
    await reload(router);
    await context.audit("settings.smtp", "settings", "smtp");
    return context.redirect("/admin/settings/smtp", "邮件设置已保存。");
  });

  router.post("/admin/settings/smtp/test", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const depsInner = router.deps;
    const host = formTrimmed(context.body, "smtp_host") || config.get("SMTP_HOST", "");
    const target = formTrimmed(context.body, "notify_email") || config.get("NOTIFY_EMAIL", "");
    if (host === "" || target === "") return context.json({ ok: false, error: "请先填写 SMTP 服务器与收件邮箱。" }, 400);
    if (depsInner.mailer === undefined) return context.json({ ok: false, error: "邮件发送服务未配置。" }, 400);
    try {
      await depsInner.mailer.sendTest(target, `【${config.get("SITE_NAME", "")}】SMTP 测试邮件`, "<p>这是一封测试邮件，用于确认 SMTP 配置无误。</p>");
      await context.audit("settings.smtp_test", "settings", "smtp", { target });
      return context.json({ ok: true, note: `测试邮件已发送至 ${target}` });
    } catch (error) {
      await context.audit("settings.smtp_test", "settings", "smtp", { error: errorMessage(error).slice(0, 200) });
      return context.json({ ok: false, error: errorMessage(error) });
    }
  });

  // ------------------------------------------------------------- payment
  router.get("/admin/settings/payment", async (context) => {
    const settings = readSettings(config);
    return context.render("settings/payment", {
      pageTitle: "支付设置",
      nav: "settings_payment",
      settings,
      private_key_configured: secretConfigured(config, "SG65_MERCHANT_PRIVATE_KEY"),
      public_key_configured: secretConfigured(config, "SG65_PLATFORM_PUBLIC_KEY"),
      notify_url: `${appUrl(config)}/payments/sg65/notify`,
      return_url: `${appUrl(config)}/payments/sg65/return`,
      epay_private_configured: secretConfigured(config, "EPAY_V2_MERCHANT_PRIVATE_KEY"),
      epay_public_configured: secretConfigured(config, "EPAY_V2_PLATFORM_PUBLIC_KEY"),
      epay_notify_url: `${appUrl(config)}/payments/epayv2/notify`,
      epay_return_url: `${appUrl(config)}/payments/epayv2/return`,
      epay_submit_url: epaySubmitUrl(config),
    });
  });

  router.post("/admin/settings/payment", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const body = context.body;
    const pid = formTrimmed(body, "sg65_pid");
    if (pid === "") return context.redirect("/admin/settings/payment", "商户 ID 不能为空。", "error");

    const allowed = ["alipay", "wxpay", "qqpay"];
    const posted = formList(body, "sg65_types");
    let enabledTypes = posted.filter((entry) => allowed.includes(entry));
    if (enabledTypes.length === 0) enabledTypes = ["alipay"];
    let defaultType = formString(body, "sg65_default_type", "alipay");
    if (!enabledTypes.includes(defaultType)) defaultType = enabledTypes[0]!;

    const saved = await saveSettings(router, context, {
      SG65_ENABLED: formBool(body, "sg65_enabled") ? "1" : "0",
      SG65_PID: pid,
      SG65_DEFAULT_PAYMENT_TYPE: defaultType,
      SG65_DEFAULT_METHOD: formString(body, "sg65_default_method", "jump") === "web" ? "web" : "jump",
      SG65_ENABLED_TYPES: enabledTypes.join(","),
      SHOP_FEE_PERCENT: String(Math.min(100, Math.max(0, formFloat(body, "shop_fee_percent", 3)))),
    });
    if (!saved) return context.reply;
    await maybeSaveSecret(router, "SG65_MERCHANT_PRIVATE_KEY", formTrimmed(body, "sg65_merchant_private_key"));
    await maybeSaveSecret(router, "SG65_PLATFORM_PUBLIC_KEY", formTrimmed(body, "sg65_platform_public_key"));

    await reload(router);
    await context.audit("settings.payment", "settings", "payment", { pid });
    return context.redirect("/admin/settings/payment", "支付设置已保存。");
  });

  router.post("/admin/settings/payment/test", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    if (router.deps.sg65Probe === undefined) return context.json({ ok: false, error: "SG65 客户端未配置。" }, 400);
    try {
      const data = await router.deps.sg65Probe.merchantInfo();
      await context.audit("settings.payment_test", "settings", "payment", { ok: true });
      return context.json({ ok: true, data });
    } catch (error) {
      return context.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  // ---------------------------------------------------------------- auth
  router.post("/admin/settings/payment/epay", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const body = context.body;
    const pid = formTrimmed(body, "epay_pid");
    const base = (formTrimmed(body, "epay_base_url") || "https://666.hboqy.cn/xpay/epayn").replace(/\/+$/, "");
    if (!isHttpBaseUrl(base)) return context.redirect("/admin/settings/payment", "易支付地址必须是合法的 HTTP(S) 地址。", "error");
    const posted = formList(body, "epay_types").filter((entry) => ["alipay", "wxpay", "qqpay"].includes(entry));
    const types = posted.length > 0 ? posted : ["alipay"];
    let defaultType = formString(body, "epay_default_type", types[0]!);
    if (!types.includes(defaultType)) defaultType = types[0]!;
    const saved = await saveSettings(router, context, {
      EPAY_V2_ENABLED: formBool(body, "epay_enabled") ? "1" : "0",
      EPAY_V2_BASE_URL: base,
      EPAY_V2_PID: pid,
      EPAY_V2_DEFAULT_TYPE: defaultType,
      EPAY_V2_ENABLED_TYPES: types.join(","),
    });
    if (!saved) return context.reply;
    await maybeSaveSecret(router, "EPAY_V2_MERCHANT_PRIVATE_KEY", formTrimmed(body, "epay_merchant_private_key"));
    await maybeSaveSecret(router, "EPAY_V2_PLATFORM_PUBLIC_KEY", formTrimmed(body, "epay_platform_public_key"));
    await reload(router);
    await context.audit("settings.epay", "settings", "payment", { pid });
    return context.redirect("/admin/settings/payment", "易支付V2 设置已保存。");
  });

  router.post("/admin/settings/payment/epay-test", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const base = epaySubmitUrl(config).replace(/\/api\/pay\/submit$/, "");
    const privateKey = config.get("EPAY_V2_MERCHANT_PRIVATE_KEY", "");
    const publicKey = config.get("EPAY_V2_PLATFORM_PUBLIC_KEY", "");
    const checks: Record<string, unknown> = { base };
    try {
      const { createPrivateKey, createPublicKey } = await import("node:crypto");
      const { toPem } = await import("../shop-legacy/sg65-signer.js");
      if (privateKey === "") checks["private_key"] = "未配置";
      else { createPrivateKey(toPem(privateKey, ["PRIVATE KEY", "RSA PRIVATE KEY"])); checks["private_key"] = "可解析"; }
      if (publicKey === "") checks["public_key"] = "未配置";
      else { createPublicKey(toPem(publicKey, ["PUBLIC KEY", "RSA PUBLIC KEY"])); checks["public_key"] = "可解析"; }
    } catch (error) {
      return context.json({ ok: false, error: `密钥无法解析：${errorMessage(error)}`, checks });
    }
    try {
      const response = await fetch(base, { method: "GET", signal: AbortSignal.timeout(8000), redirect: "manual" });
      checks["http_status"] = response.status;
      await context.audit("settings.epay_test", "settings", "payment", { ok: true });
      return context.json({ ok: true, checks });
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      return context.json({ ok: false, error: `网关不可达：${cause?.code ?? errorMessage(error)}`, checks }, 400);
    }
  });

  router.get("/admin/settings/auth", async (context) => {
    const base = appUrl(config);
    return context.render("settings/auth", {
      pageTitle: "登录设置",
      nav: "settings_auth",
      settings: readSettings(config),
      aggregate_key_placeholder: secretConfigured(config, "AGGREGATE_OAUTH_APP_KEY") ? MASK : "",
      qq_callback: `${base}/auth/social/callback?provider=qq`,
      wx_callback: `${base}/auth/social/callback?provider=wx`,
    });
  });

  router.post("/admin/settings/auth", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const body = context.body;
    const appId = formTrimmed(body, "aggregate_app_id");
    const endpoint = formTrimmed(body, "aggregate_endpoint") || "https://a.idcfx.net/connect.php";
    const parsed = parseHttpUrl(endpoint);
    if (parsed === null || parsed.protocol !== "https:" || parsed.pathname.replace(/^\/+|\/+$/g, "") === "") {
      return context.redirect("/admin/settings/auth", "聚合登录接口必须是包含路径的 HTTPS URL。", "error");
    }
    const appKeyInput = formTrimmed(body, "aggregate_app_key");
    const appKey = appKeyInput !== "" && appKeyInput !== MASK ? appKeyInput : config.secret?.("AGGREGATE_OAUTH_APP_KEY", "") ?? "";
    const qqEnabled = formBool(body, "qq_enabled");
    const wxEnabled = formBool(body, "wx_enabled");
    if ((qqEnabled || wxEnabled) && (appId === "" || appKey === "")) {
      return context.redirect("/admin/settings/auth", "启用 QQ/微信聚合登录前，请完整填写 AppID 和 AppKey。", "error");
    }

    const saved = await saveSettings(router, context, {
      REGISTRATION_ENABLED: formBool(body, "registration_enabled") ? "1" : "0",
      QQ_LOGIN_ENABLED: qqEnabled ? "1" : "0",
      WX_LOGIN_ENABLED: wxEnabled ? "1" : "0",
      AGGREGATE_OAUTH_APP_ID: appId,
      AGGREGATE_OAUTH_ENDPOINT: `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`,
    });
    if (!saved) return context.reply;
    if (appKeyInput !== "" && appKeyInput !== MASK) await maybeSaveSecret(router, "AGGREGATE_OAUTH_APP_KEY", appKeyInput);
    const store = config.settings;
    if (store?.remove !== undefined) await store.remove(["QQ_APP_ID", "QQ_APP_KEY", "WX_APP_ID", "WX_APP_KEY"]);
    await reload(router);
    await context.audit("settings.auth", "settings", "auth");
    return context.redirect("/admin/settings/auth", "登录设置已保存。");
  });

  // ------------------------------------------------------------ voicehub
  router.get("/admin/settings/voicehub", async (context) => {
    const depsInner = router.deps;
    const latest = async (status: string): Promise<Row | null> => {
      const page = await depsInner.voicehubDeliveries.list({ status }, 1, 1);
      return page.items[0] ?? null;
    };
    return context.render("settings/voicehub", {
      pageTitle: "VoiceHub 设置",
      nav: "settings_voicehub",
      settings: readSettings(config),
      token_placeholder: secretConfigured(config, "VOICEHUB_API_TOKEN") ? MASK : "",
      last_success: await latest("success"),
      last_failure: await latest("failed"),
      stats: await statsWithTotals(router),
    });
  });

  router.post("/admin/settings/voicehub", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const body = context.body;
    const base = formTrimmed(body, "voicehub_api_base").replace(/\/+$/, "");
    if (base !== "" && !isHttpBaseUrl(base)) {
      return context.redirect("/admin/settings/voicehub", "VoiceHub Base URL 必须是无账号、查询参数和片段的 HTTP(S) 地址。", "error");
    }
    const endpoint = formTrimmed(body, "voicehub_ticket_endpoint") || "/api/open/card-codes";
    if (!isRelativeEndpoint(endpoint)) {
      return context.redirect("/admin/settings/voicehub", "VoiceHub Endpoint 必须是以单个 / 开头的相对路径。", "error");
    }
    const saved = await saveSettings(router, context, {
      VOICEHUB_ENABLED: formBool(body, "voicehub_enabled") ? "1" : "0",
      VOICEHUB_API_BASE: base,
      VOICEHUB_TICKET_ENDPOINT: endpoint,
      VOICEHUB_TIMEOUT: String(Math.max(5, formInt(body, "voicehub_timeout", 20))),
      VOICEHUB_RETRIES: String(Math.max(1, formInt(body, "voicehub_retries", 3))),
    });
    if (!saved) return context.reply;
    await maybeSaveSecret(router, "VOICEHUB_API_TOKEN", formTrimmed(body, "voicehub_api_token"));
    await reload(router);
    await context.audit("settings.voicehub", "settings", "voicehub");
    return context.redirect("/admin/settings/voicehub", "VoiceHub 设置已保存。");
  });

  router.post("/admin/settings/voicehub/test", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const base = config.get("VOICEHUB_API_BASE", "").replace(/\/+$/, "");
    const token = config.secret?.("VOICEHUB_API_TOKEN", "") ?? "";
    if (base === "" || token === "") return context.json({ ok: false, error: "请先保存 Base URL 与 API Key。" }, 400);
    if (router.deps.voicehubProbe === undefined) return context.json({ ok: false, error: "连通性测试未配置。" }, 400);
    const result = await router.deps.voicehubProbe(base, token);
    await context.audit("settings.voicehub_test", "settings", "voicehub", { reachable: result.reachable });
    return context.json({
      ok: result.reachable,
      error: result.reachable ? "" : result.error || "无法连接 VoiceHub",
      http_status: result.status,
      note: "仅测试连通性，未发放正式券。",
    });
  });

  // -------------------------------------------------------------- afdian
  router.get("/admin/settings/afdian", async (context) =>
    context.render("settings/afdian", {
      pageTitle: "爱发电设置",
      nav: "settings_afdian",
      settings: readSettings(config),
      token_placeholder: secretConfigured(config, "AFDIAN_API_TOKEN") ? MASK : "",
      webhook_url: `${appUrl(config)}/webhook/afdian`,
      last_webhook: config.get("AFDIAN_LAST_WEBHOOK_AT", "") || null,
      last_poll: config.get("AFDIAN_LAST_POLL_AT", "") || null,
    }),
  );

  router.post("/admin/settings/afdian", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const body = context.body;
    const base = formTrimmed(body, "afdian_api_base").replace(/\/+$/, "") || "https://ifdian.net";
    if (!isHttpBaseUrl(base)) {
      return context.redirect("/admin/settings/afdian", "爱发电 API Base 必须是无账号、查询参数和片段的 HTTP(S) 地址。", "error");
    }
    const endpoint = formTrimmed(body, "afdian_order_endpoint") || "/api/open/query-order";
    if (!isRelativeEndpoint(endpoint)) {
      return context.redirect("/admin/settings/afdian", "爱发电 Endpoint 必须是以单个 / 开头的相对路径。", "error");
    }
    const saved = await saveSettings(router, context, {
      AFDIAN_ENABLED: formBool(body, "afdian_enabled") ? "1" : "0",
      // 轮询开关：关掉后只依赖 Webhook 通知，不再主动拉取订单。
      AFDIAN_POLL_ENABLED: formBool(body, "afdian_poll_enabled") ? "1" : "0",
      AFDIAN_USER_ID: formTrimmed(body, "afdian_user_id"),
      AFDIAN_API_BASE: base,
      AFDIAN_ORDER_ENDPOINT: endpoint,
      AFDIAN_WEBHOOK_REQUIRE_SIGNATURE: formBool(body, "afdian_require_signature") ? "1" : "0",
      AFDIAN_POLL_LIMIT: String(Math.max(1, formInt(body, "afdian_poll_limit", 20))),
      AFDIAN_POLL_PER_PAGE: String(Math.max(1, Math.min(100, formInt(body, "afdian_poll_per_page", 50)))),
      AFDIAN_FEE_PERCENT: String(Math.min(100, Math.max(0, formFloat(body, "afdian_fee_percent", 6)))),
    });
    if (!saved) return context.reply;
    await maybeSaveSecret(router, "AFDIAN_API_TOKEN", formTrimmed(body, "afdian_api_token"));
    await reload(router);
    await context.audit("settings.afdian", "settings", "afdian");
    return context.redirect("/admin/settings/afdian", "爱发电设置已保存。");
  });

  router.post("/admin/settings/afdian/test", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    if (router.deps.afdianProcessor === undefined) return context.json({ ok: false, error: "爱发电客户端未配置。" }, 400);
    try {
      const orders = await router.deps.afdianProcessor.processPoll();
      await context.audit("settings.afdian_test", "settings", "afdian", { ok: true });
      return context.json({ ok: true, orders_returned: orders.length });
    } catch (error) {
      return context.json({ ok: false, error: errorMessage(error) }, 400);
    }
  });

  // ------------------------------------------------------------ security
  router.get("/admin/settings/security", async (context) =>
    context.render("settings/security", {
      pageTitle: "安全设置",
      nav: "settings_security",
      settings: readSettings(config),
      master_key_configured: secretConfigured(config, "APP_MASTER_KEY") || config.get("APP_MASTER_KEY", "") !== "",
      https: /^https$/i.test(String(context.request.headers["x-forwarded-proto"] ?? "")) || Boolean(context.request.protocol === "https"),
      session_name: "vhp_session",
      csrf_enabled: true,
    }),
  );

  router.post("/admin/settings/security", async (context) => {
    if (!(await context.requireCsrf())) return context.reply;
    const saved = await saveSettings(router, context, {
      SECURITY_FORCE_HTTPS: formBool(context.body, "force_https") ? "1" : "0",
      SECURITY_ADMIN_SESSION_MINUTES: String(Math.max(10, formInt(context.body, "admin_session_minutes", 120))),
    });
    if (!saved) return context.reply;
    await reload(router);
    await context.audit("settings.security", "settings", "security");
    return context.redirect("/admin/settings/security", "安全设置已保存。");
  });
}

/* ------------------------------------------------------------------ helpers */

function readSettings(config: AdminConfigPort): Record<string, string> {
  if (config.settings === undefined) return {};
  try {
    return config.settings.all();
  } catch {
    return {};
  }
}

async function saveSettings(router: AdminRouter, context: AdminContext, values: Record<string, string>): Promise<boolean> {
  const store = router.deps.config.settings;
  if (store === undefined) {
    await context.flash("设置存储未配置，无法保存。", "error");
    await context.redirect("/admin");
    return false;
  }
  const previous = store.all();
  const merged: Record<string, string> = { ...previous };
  for (const [key, value] of Object.entries(values)) merged[key] = value;
  await store.saveMany(merged);
  return true;
}

async function reload(router: AdminRouter): Promise<void> {
  if (router.deps.config.reloadSettings !== undefined) await router.deps.config.reloadSettings();
}

async function maybeSaveSecret(router: AdminRouter, key: string, value: string, placeholder = MASK): Promise<void> {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === placeholder) return;
  if (router.deps.config.setSecret !== undefined) await router.deps.config.setSecret(key, trimmed);
}

function secretConfigured(config: AdminConfigPort, key: string): boolean {
  if (config.secret === undefined) return false;
  try {
    return config.secret(key, "") !== "";
  } catch {
    return false;
  }
}

function appUrl(config: AdminConfigPort): string {
  if (config.appUrl !== undefined) return config.appUrl();
  return config.get("SITE_URL", config.get("APP_URL", "")).replace(/\/+$/, "");
}

export function parseHttpUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.hostname === "") return null;
  return url;
}

function isHttpBaseUrl(value: string): boolean {
  return parseHttpUrl(value) !== null;
}

function isRelativeEndpoint(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("://");
}

function isEmail(value: string): boolean {
  const address = value.trim();
  if (address === "" || /\s/.test(address)) return false;
  return /^[^@<>()[\]\\,;:]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(address);
}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Canonical "/x" form; null when invalid; "" for the standard paths. */
export function normalizeAuthPrefix(raw: string): string | null {
  const value = raw.trim();
  if (value === "" || value === "/" || value === "//") return "";
  if (!value.startsWith("/")) return null;
  if (/[\s?#]/.test(value)) return null;
  const normalized = value.replace(/\/+/g, "/").replace(/\/+$/, "");
  return normalized === "" ? null : normalized;
}

async function statsWithTotals(router: AdminRouter): Promise<Record<string, number>> {
  const deps = router.deps;
  const stats = await deps.voicehubDeliveries.stats().catch((): Record<string, number> => ({}));
  const total = Object.values(stats).reduce((sum, value) => sum + Number(value ?? 0), 0);
  const successToday = await deps.voicehubDeliveries.countTodayByStatus("success").catch(() => 0);
  const failedToday = await deps.voicehubDeliveries.countTodayByStatus("failed").catch(() => 0);
  return { ...stats, total, today: successToday + failedToday };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
