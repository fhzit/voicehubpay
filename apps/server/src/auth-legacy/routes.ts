import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthService, codePoints } from "./auth-service.js";
import { Csrf } from "./csrf.js";
import { PasswordHasher } from "./password-hasher.js";
import { SESSION_COOKIE, SessionManager } from "./session-manager.js";
import type { LegacyAuthDependencies, LegacySessionContext, Row } from "./types.js";

/**
 * Faithful ports of VoiceHubPay\Controllers\AuthController and
 * VoiceHubPay\Controllers\AccountController as Fastify route configurators.
 *
 * Exports (wired later by app integration):
 *   - configureAuthRoutes(app, deps)  — /login, /register, /auth/password/*,
 *     /logout, /complete-social, /auth/social/{provider}, /auth/social/callback
 *   - configureAccountRoutes(app, deps) — /account, /account/orders,
 *     /account/cards, /account/connections (+ unbind), /account/security
 *     (+ password), /account/profile (+ update), /account/complete
 *
 * Session cookie: HttpOnly, SameSite=Lax. Flash messages ride the sessions
 * table (flash key consumed on first read). Redirects are 303 See Other.
 */
export function configureAuthRoutes(app: FastifyInstance, deps: LegacyAuthDependencies): void {
  const service = new AuthService(deps.users, deps.social, deps.config, deps.clock ?? { now: () => Math.floor(Date.now() / 1000) });
  const sessions = new SessionManager(deps.sessions, deps.clock ?? { now: () => Math.floor(Date.now() / 1000) });
  const secure = deps.secureCookies ?? false;

  const cookie = (id: string): string => `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  const clearedCookie = (): string => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

  const readSessionCookie = (request: FastifyRequest): string | null => {
    const header = request.headers.cookie;
    if (!header) return null;
    for (const part of header.split(";")) {
      const trimmed = part.trim();
      if (trimmed.startsWith(`${SESSION_COOKIE}=`)) return trimmed.slice(SESSION_COOKIE.length + 1) || null;
    }
    return null;
  };

  const startSession = async (request: FastifyRequest, reply: FastifyReply): Promise<LegacySessionContext> => {
    const context = await sessions.start(readSessionCookie(request));
    if (context.isNew) reply.header("set-cookie", cookie(context.id));
    request.legacySession = context;
    return context;
  };

  const authUrl = (route: string): string => deps.config.authUrl(route);

  const redirectTo = (reply: FastifyReply, url: string): FastifyReply => reply.code(303).header("location", url).send();

  const redirectWithFlash = (reply: FastifyReply, url: string, message: string, type: "success" | "error" = "success"): FastifyReply => {
    reply.header("x-flash-message", Buffer.from(message, "utf8").toString("base64"));
    reply.header("x-flash-type", type);
    return redirectTo(reply, url);
  };

  const requireCsrf = async (request: FastifyRequest, reply: FastifyReply, context: LegacySessionContext): Promise<boolean> => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const token = typeof body["_csrf"] === "string" ? body["_csrf"] : (request.headers["x-csrf-token"] ?? null);
    if (!Csrf.verify(context.data, typeof token === "string" ? token : null)) {
      sessions.flash(context, "会话已过期，请重新操作。", "error");
      await sessions.persist(context);
      redirectWithFlash(reply, authUrl("/login"), "会话已过期，请重新操作。", "error");
      return false;
    }
    return true;
  };

  const safeRedirect = (url: string): string => {
    if (url === "" || url === "/") return "/";
    if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\") || /[\u0000-\u001F\u007F]/.test(url)) return "/";
    try {
      const parsed = new URL(url, "http://legacy.invalid");
      if (parsed.username || parsed.password || (url.startsWith("/") && (parsed.host !== "legacy.invalid"))) return "/";
    } catch {
      return "/";
    }
    return url;
  };

  const currentUser = async (context: LegacySessionContext): Promise<Row | null> => service.user(context.data);

  const requireLogin = async (request: FastifyRequest, reply: FastifyReply, context: LegacySessionContext): Promise<boolean> => {
    const user = await currentUser(context);
    if (user === null) {
      await sessions.persist(context);
      redirectTo(reply, `${authUrl("/login")}?redirect=${encodeURIComponent(request.url.split("?")[0] ?? "/")}`);
      return false;
    }
    return true;
  };

  // -- GET {authUrl}/login : show login -------------------------------------
  app.get(authUrl("/login"), async (request, reply) => {
    const context = await startSession(request, reply);
    if (await service.isLoggedIn(context.data)) return redirectTo(reply, "/account");
    const flash = sessions.takeFlash(context);
    const csrfToken = Csrf.token(context.data);
    await sessions.persist(context);
    return reply.code(200).send({
      template: "auth/login",
      data: {
        redirect: queryParam(request, "redirect", "/"),
        qq_enabled: deps.config.bool("QQ_LOGIN_ENABLED", false),
        wx_enabled: deps.config.bool("WX_LOGIN_ENABLED", false),
        flash,
        csrf_token: csrfToken,
      },
    });
  });

  // -- GET {authUrl}/register : show register -------------------------------
  app.get(authUrl("/register"), async (request, reply) => {
    const context = await startSession(request, reply);
    if (await service.isLoggedIn(context.data)) return redirectTo(reply, "/account");
    const flash = sessions.takeFlash(context);
    const csrfToken = Csrf.token(context.data);
    await sessions.persist(context);
    return reply.code(200).send({
      template: "auth/register",
      data: {
        registration_enabled: deps.config.bool("REGISTRATION_ENABLED", true),
        qq_enabled: deps.config.bool("QQ_LOGIN_ENABLED", false),
        wx_enabled: deps.config.bool("WX_LOGIN_ENABLED", false),
        flash,
        csrf_token: csrfToken,
      },
    });
  });

  // -- POST /auth/password/login --------------------------------------------
  app.post("/auth/password/login", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireCsrf(request, reply, context))) return reply;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const username = formString(body["username"]);
    const password = formString(body["password"]);
    const result = await service.loginWithPassword(username, password, deps.throttle, request.ip);
    if (!result.ok) {
      sessions.flash(context, result.error, "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, `${authUrl("/login")}?redirect=${encodeURIComponent(formString(body["redirect"]) || "/")}`, result.error, "error");
    }
    await sessions.regenerate(context);
    reply.header("set-cookie", cookie(context.id));
    await service.loginUser(context.data, result.user!);
    await sessions.persist(context);
    const user = result.user!;
    return redirectWithFlash(reply, safeRedirect(formString(body["redirect"]) || "/"), `欢迎回来，${String(user["display_name"] || user["username"])}`);
  });

  // -- POST /auth/password/register -----------------------------------------
  app.post("/auth/password/register", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireCsrf(request, reply, context))) return reply;
    // Logged-in users must not create a second account — same guard as PHP.
    if (await service.isLoggedIn(context.data)) {
      sessions.flash(context, "您已登录，请直接在账号信息中为当前账号设置用户名和密码，无需重新注册。");
      await sessions.persist(context);
      return redirectWithFlash(reply, "/account?complete=1", "您已登录，请直接在账号信息中为当前账号设置用户名和密码，无需重新注册。");
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await service.register(
      formString(body["username"]),
      formString(body["password"]),
      formString(body["password_confirm"]),
      formString(body["display_name"]),
      formInt(body["agreed"]) !== 0,
      formString(body["email"]),
    );
    if (!result.ok) {
      sessions.flash(context, result.error, "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, authUrl("/register"), result.error, "error");
    }
    await sessions.regenerate(context);
    reply.header("set-cookie", cookie(context.id));
    await service.loginUser(context.data, result.user!);
    await sessions.persist(context);
    return redirectWithFlash(reply, "/account", "注册成功，欢迎加入！");
  });

  // -- GET {authUrl}/complete-social : signup completion form ---------------
  app.get(authUrl("/complete-social"), async (request, reply) => {
    const context = await startSession(request, reply);
    const profile = context.data["social_signup_pending"] as Record<string, unknown> | undefined;
    if (!isProfile(profile) || String(profile["social_uid"] ?? "") === "") {
      sessions.flash(context, "请先使用 QQ / 微信登录后再完善账号。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, authUrl("/login"), "请先使用 QQ / 微信登录后再完善账号。", "error");
    }
    const rawProvider = String(profile["provider"] ?? "");
    const provider = ["qq", "wx"].includes(rawProvider) ? rawProvider : "qq";
    const csrfToken = Csrf.token(context.data);
    await sessions.persist(context);
    return reply.code(200).send({
      template: "auth/complete-social",
      data: { provider, nickname: String(profile["nickname"] ?? ""), avatar: String(profile["avatar_url"] ?? ""), csrf_token: csrfToken },
    });
  });

  // -- POST {authUrl}/complete-social ---------------------------------------
  app.post(authUrl("/complete-social"), async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireCsrf(request, reply, context))) return reply;
    const profile = context.data["social_signup_pending"] as Record<string, unknown> | undefined;
    if (!isProfile(profile) || String(profile["social_uid"] ?? "") === "") {
      sessions.flash(context, "登录状态已失效，请重新使用 QQ / 微信登录。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, authUrl("/login"), "登录状态已失效，请重新使用 QQ / 微信登录。", "error");
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await service.completeSocialSignup(profile, formString(body["username"]), formString(body["password"]), formString(body["password_confirm"]), formString(body["email"]));
    if (!result.ok) {
      // Keep the pending profile so the user can retry without re-auth.
      sessions.flash(context, result.error, "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, "/complete-social", result.error, "error");
    }
    delete context.data["social_signup_pending"];
    await sessions.regenerate(context);
    reply.header("set-cookie", cookie(context.id));
    await service.loginUser(context.data, result.user!);
    await sessions.persist(context);
    return redirectWithFlash(reply, "/account", "账号创建成功，欢迎加入！");
  });

  // -- POST /logout ----------------------------------------------------------
  app.post("/logout", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireCsrf(request, reply, context))) return reply;
    service.logoutData(context.data);
    sessions.flash(context, "已安全退出。");
    await sessions.persist(context);
    await sessions.destroy(context);
    reply.header("set-cookie", clearedCookie());
    return redirectWithFlash(reply, "/", "已安全退出。");
  });

  // -- GET /auth/social/{provider} : authorize redirect ---------------------
  app.get("/auth/social/:provider", async (request, reply) => {
    const context = await startSession(request, reply);
    const params = request.params as { provider?: string };
    // Aggregate platform may bounce back to this URL carrying a code — that is
    // a callback return, hand off to the callback handler.
    if (queryParam(request, "code", "") !== "") {
      return socialCallbackHandler(request, reply, context, params.provider ?? "");
    }
    const provider = params.provider ?? "";
    if (!["qq", "wx"].includes(provider)) {
      sessions.flash(context, "不支持的登录方式。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, authUrl("/login"), "不支持的登录方式。", "error");
    }
    if (!deps.config.bool(`${provider.toUpperCase()}_LOGIN_ENABLED`, false)) {
      sessions.flash(context, "该登录方式未开启。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, authUrl("/login"), "该登录方式未开启。", "error");
    }
    try {
      if (await service.isLoggedIn(context.data)) {
        context.data["social_bind_mode"] = true;
        const authorize = await deps.socialProvider.authorizeUrl(provider, "/account/connections");
        context.data["social_state"] = authorize.state;
        context.data["social_provider"] = provider;
        context.data["social_redirect"] = "/account/connections";
        await sessions.persist(context);
        return redirectTo(reply, authorize.url);
      }
      const redirectTarget = queryParam(request, "redirect", "/account");
      const authorize = await deps.socialProvider.authorizeUrl(provider, redirectTarget);
      context.data["social_state"] = authorize.state;
      context.data["social_provider"] = provider;
      context.data["social_redirect"] = redirectTarget;
      await sessions.persist(context);
      return redirectTo(reply, authorize.url);
    } catch {
      sessions.flash(context, "聚合登录服务暂时不可用，请稍后重试或使用账号密码登录。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, authUrl("/login"), "聚合登录服务暂时不可用，请稍后重试或使用账号密码登录。", "error");
    }
  });

  // -- GET /auth/social/callback ---------------------------------------------
  const socialCallbackHandler = async (request: FastifyRequest, reply: FastifyReply, context: LegacySessionContext, fallbackProvider: string): Promise<FastifyReply> => {
    let provider = queryParam(request, "provider", fallbackProvider !== "" ? fallbackProvider : "qq");
    provider = ["qq", "wx"].includes(provider) ? provider : "qq";
    const state = queryParam(request, "state", "");
    const expectedState = String(context.data["social_state"] ?? "");
    if (state === "" || !Csrf.secureCompare(expectedState, state)) {
      sessions.flash(context, "登录状态校验失败，请重试。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, authUrl("/login"), "登录状态校验失败，请重试。", "error");
    }
    if (String(context.data["social_provider"] ?? "") !== provider) {
      sessions.flash(context, "登录方式不匹配，请重试。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, authUrl("/login"), "登录方式不匹配，请重试。", "error");
    }
    const code = queryParam(request, "code", "");
    if (code === "") {
      sessions.flash(context, "未收到授权码，请重试。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, authUrl("/login"), "未收到授权码，请重试。", "error");
    }

    const bindMode = context.data["social_bind_mode"] === true;
    const redirectAfter = String(context.data["social_redirect"] ?? (bindMode ? "/account/connections" : "/account"));
    // Consume the one-time state before any account switch (replay guard).
    delete context.data["social_state"];
    delete context.data["social_provider"];
    delete context.data["social_redirect"];
    context.dirty = true;
    try {
      const profile = await deps.socialProvider.exchangeCode(provider, code);
      if (bindMode) {
        if (!(await service.isLoggedIn(context.data))) {
          delete context.data["social_bind_mode"];
          await sessions.persist(context);
          sessions.flash(context, "登录状态已失效，请重新登录后再绑定。", "error");
          return redirectWithFlash(reply, authUrl("/login"), "登录状态已失效，请重新登录后再绑定。", "error");
        }
        const result = await service.bindToCurrentUser(context.data, provider, profile);
        delete context.data["social_bind_mode"];
        await sessions.persist(context);
        if (!result.ok) return redirectWithFlash(reply, redirectAfter, result.error, "error");
        return redirectWithFlash(reply, safeRedirect(redirectAfter), result.already_bound ? "该登录方式此前已绑定。" : "绑定成功！");
      }
      // Non-bind: never silently switch accounts for an already-authenticated
      // browser (stale/second callback racing an active session).
      if (await service.isLoggedIn(context.data)) {
        sessions.flash(context, "您已登录，若需切换账号请先退出后再登录。");
        await sessions.persist(context);
        return redirectWithFlash(reply, "/account", "您已登录，若需切换账号请先退出后再登录。");
      }
      const result = await service.loginWithSocial(provider, profile);
      if (!result.ok) {
        sessions.flash(context, result.error, "error");
        await sessions.persist(context);
        return redirectWithFlash(reply, authUrl("/login"), result.error, "error");
      }
      if (result.needs_signup) {
        delete context.data["social_bind_mode"];
        context.data["social_signup_pending"] = result.profile;
        await sessions.persist(context);
        sessions.flash(context, "请设置您的用户名和密码以完成账号创建。");
        return redirectWithFlash(reply, "/complete-social", "请设置您的用户名和密码以完成账号创建。");
      }
      await sessions.regenerate(context);
      reply.header("set-cookie", cookie(context.id));
      await service.loginUser(context.data, result.user!);
      await sessions.persist(context);
      return redirectWithFlash(reply, safeRedirect(redirectAfter), "登录成功！");
    } catch {
      // Keep provider diagnostics out of the browser.
      sessions.flash(context, "第三方登录失败，请稍后重试或联系管理员。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, bindMode ? redirectAfter : authUrl("/login"), "第三方登录失败，请稍后重试或联系管理员。", "error");
    }
  };

  app.get("/auth/social/callback", async (request, reply) => {
    const context = await startSession(request, reply);
    return socialCallbackHandler(request, reply, context, "");
  });
}

/** Account routes: overview, orders, cards, connections, security, profile. */
export function configureAccountRoutes(app: FastifyInstance, deps: LegacyAuthDependencies): void {
  const service = new AuthService(deps.users, deps.social, deps.config, deps.clock ?? { now: () => Math.floor(Date.now() / 1000) });
  const sessions = new SessionManager(deps.sessions, deps.clock ?? { now: () => Math.floor(Date.now() / 1000) });
  const secure = deps.secureCookies ?? false;

  const cookie = (id: string): string => `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  const readSessionCookie = (request: FastifyRequest): string | null => {
    const header = request.headers.cookie;
    if (!header) return null;
    for (const part of header.split(";")) {
      const trimmed = part.trim();
      if (trimmed.startsWith(`${SESSION_COOKIE}=`)) return trimmed.slice(SESSION_COOKIE.length + 1) || null;
    }
    return null;
  };
  const startSession = async (request: FastifyRequest, reply: FastifyReply): Promise<LegacySessionContext> => {
    const context = await sessions.start(readSessionCookie(request));
    if (context.isNew) reply.header("set-cookie", cookie(context.id));
    request.legacySession = context;
    return context;
  };
  const redirectTo = (reply: FastifyReply, url: string): FastifyReply => reply.code(303).header("location", url).send();
  const redirectWithFlash = (reply: FastifyReply, url: string, message: string, type: "success" | "error" = "success"): FastifyReply => {
    reply.header("x-flash-message", Buffer.from(message, "utf8").toString("base64"));
    reply.header("x-flash-type", type);
    return redirectTo(reply, url);
  };
  const currentUser = async (context: LegacySessionContext): Promise<Row | null> => service.user(context.data);
  const requireLogin = async (request: FastifyRequest, reply: FastifyReply, context: LegacySessionContext): Promise<boolean> => {
    const user = await currentUser(context);
    if (user === null) {
      await sessions.persist(context);
      redirectTo(reply, `${deps.config.authUrl("/login")}?redirect=${encodeURIComponent(request.url.split("?")[0] ?? "/")}`);
      return false;
    }
    return true;
  };
  const requireCsrf = async (request: FastifyRequest, reply: FastifyReply, context: LegacySessionContext): Promise<boolean> => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const token = typeof body["_csrf"] === "string" ? body["_csrf"] : (request.headers["x-csrf-token"] ?? null);
    if (!Csrf.verify(context.data, typeof token === "string" ? token : null)) {
      sessions.flash(context, "会话已过期，请重新操作。", "error");
      await sessions.persist(context);
      redirectWithFlash(reply, deps.config.authUrl("/login"), "会话已过期，请重新操作。", "error");
      return false;
    }
    return true;
  };
  const audit = async (userId: number, action: string, objectType: string, objectId: string, metadata: Record<string, unknown>, request: FastifyRequest): Promise<void> => {
    if (!deps.audit) return;
    await deps.audit.log(userId, action, objectType, objectId, metadata, request.ip, request.headers["user-agent"] ?? "");
  };

  // -- GET /account : overview -----------------------------------------------
  app.get("/account", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireLogin(request, reply, context))) return reply;
    const user = (await currentUser(context))!;
    const orders = deps.orders;
    const recentOrders = orders ? await orders.listForUserLatest(Number(user["id"]), 5) : [];
    const orderCount = orders ? (await orders.listForUser(Number(user["id"]), "", "", 1, 1)).total : 0;
    const cardCount = deps.units ? await deps.units.countDeliveredForUser(Number(user["id"])) : 0;
    const connections = await deps.social.listForUser(Number(user["id"]));
    return reply.code(200).send({
      template: "account/overview",
      data: {
        recent_orders: recentOrders,
        order_count: orderCount,
        card_count: cardCount,
        connections,
        has_password: isNonEmptyString(user["password_hash"]),
      },
    });
  });

  // -- GET /account/orders ----------------------------------------------------
  app.get("/account/orders", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireLogin(request, reply, context))) return reply;
    const user = (await currentUser(context))!;
    const status = queryParam(request, "status", "");
    const q = queryParam(request, "q", "");
    const page = Math.max(1, queryInt(request, "page", 1));
    const result = deps.orders
      ? await deps.orders.listForUser(Number(user["id"]), status, q, page, 10)
      : { items: [], total: 0, page, perPage: 10 };
    return reply.code(200).send({
      template: "account/orders",
      data: {
        orders: result.items,
        total: result.total,
        page: result.page,
        pages: Math.ceil(result.total / Math.max(1, result.perPage)),
        status,
        q,
      },
    });
  });

  // -- GET /account/cards ------------------------------------------------------
  app.get("/account/cards", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireLogin(request, reply, context))) return reply;
    const user = (await currentUser(context))!;
    const status = queryParam(request, "status", "");
    const q = queryParam(request, "q", "");
    const page = Math.max(1, queryInt(request, "page", 1));
    const result = deps.units
      ? await deps.units.listForUser(Number(user["id"]), status, q, page, 10)
      : { items: [], total: 0, page, perPage: 10 };
    const cards = result.items.map((item) => {
      const cipher = item["delivery_code_ciphertext"];
      return {
        ...item,
        code_masked: typeof cipher === "string" && cipher !== "" && deps.crypto ? deps.crypto.mask(deps.crypto.decrypt(cipher)) : "",
        code_source_label: sourceLabel(item),
      };
    });
    return reply.code(200).send({
      template: "account/cards",
      data: { cards, total: result.total, page: result.page, pages: Math.ceil(result.total / Math.max(1, result.perPage)), status, q },
    });
  });

  // -- GET /account/connections -------------------------------------------------
  app.get("/account/connections", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireLogin(request, reply, context))) return reply;
    const user = (await currentUser(context))!;
    const connections = await deps.social.listForUser(Number(user["id"]));
    return reply.code(200).send({
      template: "account/connections",
      data: {
        connections,
        has_password: isNonEmptyString(user["password_hash"]),
        qq_enabled: deps.config.bool("QQ_LOGIN_ENABLED", false),
        wx_enabled: deps.config.bool("WX_LOGIN_ENABLED", false),
      },
    });
  });

  // -- POST /account/connections/unbind ------------------------------------------
  app.post("/account/connections/unbind", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireLogin(request, reply, context))) return reply;
    if (!(await requireCsrf(request, reply, context))) return reply;
    const user = (await currentUser(context))!;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const provider = formString(body["provider"]);
    if (!["qq", "wx"].includes(provider)) {
      sessions.flash(context, "不支持的登录方式。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, "/account/connections", "不支持的登录方式。", "error");
    }
    const identity = await deps.social.getProvider(Number(user["id"]), provider);
    if (identity === null) {
      sessions.flash(context, "该登录方式未绑定。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, "/account/connections", "该登录方式未绑定。", "error");
    }
    // Never remove the last remaining login method.
    if ((await deps.social.loginMethodCount(user)) <= 1) {
      sessions.flash(context, "至少需要保留一种登录方式。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, "/account/connections", "至少需要保留一种登录方式。", "error");
    }
    await deps.social.unbind(Number(user["id"]), provider);
    await audit(Number(user["id"]), "social.unbind", "user", String(user["id"]), { provider }, request);
    await sessions.persist(context);
    return redirectWithFlash(reply, "/account/connections", `已解绑 ${provider === "qq" ? "QQ" : "微信"} 登录。`);
  });

  // -- GET /account/security -------------------------------------------------------
  app.get("/account/security", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireLogin(request, reply, context))) return reply;
    const user = (await currentUser(context))!;
    const csrfToken = Csrf.token(context.data);
    await sessions.persist(context);
    return reply.code(200).send({
      template: "account/security",
      data: {
        has_password: isNonEmptyString(user["password_hash"]),
        session_created: context.data["created_at"] ?? null,
        csrf_token: csrfToken,
      },
    });
  });

  // -- POST /account/security/password : change password ----------------------------
  app.post("/account/security/password", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireLogin(request, reply, context))) return reply;
    if (!(await requireCsrf(request, reply, context))) return reply;
    const user = (await currentUser(context))!;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const current = formString(body["current_password"]);
    const new1 = formString(body["new_password"]);
    const confirm = formString(body["new_password_confirm"]);
    const hash = user["password_hash"];
    const hasPassword = typeof hash === "string" && hash !== "";
    if (hasPassword && !(await PasswordHasher.verify(current, hash as string))) {
      sessions.flash(context, "当前密码不正确。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, "/account/security", "当前密码不正确。", "error");
    }
    if (new1.length < 8) {
      sessions.flash(context, "新密码至少需要 8 位。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, "/account/security", "新密码至少需要 8 位。", "error");
    }
    if (new1 !== confirm) {
      sessions.flash(context, "两次输入的新密码不一致。", "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, "/account/security", "两次输入的新密码不一致。", "error");
    }
    await deps.users.setPassword(Number(user["id"]), await PasswordHasher.hash(new1));
    await audit(Number(user["id"]), "password.change", "user", String(user["id"]), {}, request);
    await sessions.persist(context);
    return redirectWithFlash(reply, "/account/security", "密码已更新。");
  });

  // -- GET /account/profile ------------------------------------------------------------
  app.get("/account/profile", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireLogin(request, reply, context))) return reply;
    const user = (await currentUser(context))!;
    const csrfToken = Csrf.token(context.data);
    await sessions.persist(context);
    return reply.code(200).send({ template: "account/profile", data: { has_password: isNonEmptyString(user["password_hash"]), csrf_token: csrfToken } });
  });

  // -- POST /account/profile : update profile --------------------------------------------
  app.post("/account/profile", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireLogin(request, reply, context))) return reply;
    if (!(await requireCsrf(request, reply, context))) return reply;
    const user = (await currentUser(context))!;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const username = formString(body["username"]);
    const nickname = formString(body["display_name"]);

    // Username is optional — only update when a new value is given.
    if (username !== "" && username !== String(user["username"] ?? "")) {
      const result = await service.changeUsername(Number(user["id"]), username);
      if (!result.ok) {
        sessions.flash(context, result.error, "error");
        await sessions.persist(context);
        return redirectWithFlash(reply, "/account/profile", result.error, "error");
      }
    }
    if (nickname !== "") {
      const result = await service.updateNickname(Number(user["id"]), nickname);
      if (!result.ok) {
        sessions.flash(context, result.error, "error");
        await sessions.persist(context);
        return redirectWithFlash(reply, "/account/profile", result.error, "error");
      }
    }
    // Email is optional to keep; empty clears it.
    const email = formString(body["email"]);
    if (email !== String(user["email"] ?? "")) {
      const result = await service.updateEmail(Number(user["id"]), email);
      if (!result.ok) {
        sessions.flash(context, result.error, "error");
        await sessions.persist(context);
        return redirectWithFlash(reply, "/account/profile", result.error, "error");
      }
    }
    await audit(Number(user["id"]), "profile.update", "user", String(user["id"]), {}, request);
    await sessions.persist(context);
    return redirectWithFlash(reply, "/account/profile", "账号信息已更新。");
  });

  // -- POST /account/complete : one-shot social account completion -------------------------
  app.post("/account/complete", async (request, reply) => {
    const context = await startSession(request, reply);
    if (!(await requireLogin(request, reply, context))) return reply;
    if (!(await requireCsrf(request, reply, context))) return reply;
    const user = (await currentUser(context))!;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await service.completeUsernamePassword(Number(user["id"]), formString(body["username"]), formString(body["password"]), formString(body["password_confirm"]));
    if (!result.ok) {
      sessions.flash(context, result.error, "error");
      await sessions.persist(context);
      return redirectWithFlash(reply, "/account?complete=1", result.error, "error");
    }
    await sessions.persist(context);
    return redirectWithFlash(reply, "/account", "账号设置完成，已使用用户名和密码登录。");
  });
}

/** Port of AccountController::sourceLabel(). */
function sourceLabel(item: Row): string {
  const mode = String(item["delivery_mode_snapshot"] ?? "");
  if (mode === "card_and_voicehub" || mode === "card") return "库存卡密";
  if (mode === "voicehub") return "商城订单券码";
  if (mode === "manual") return "人工发放";
  return "卡券";
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value !== "";
}

function formString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formInt(value: unknown): number {
  const parsed = Number.parseInt(typeof value === "string" ? value : String(value ?? ""), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function queryParam(request: FastifyRequest, key: string, fallback = ""): string {
  const value = (request.query as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : fallback;
}

function queryInt(request: FastifyRequest, key: string, fallback: number): number {
  const parsed = Number.parseInt(queryParam(request, key, ""), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function isProfile(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Referenced helper retained: code point counting used by updateNickname path.
void codePoints;
