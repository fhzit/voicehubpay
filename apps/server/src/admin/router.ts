/**
 * Route plumbing shared by every admin module.
 *
 * Mirrors the PHP `Controller` base class: session bootstrap, `requireAdmin`
 * (302 to the login page / 403 page), CSRF verification with a flash+redirect
 * on failure, flash messages, audit logging and view rendering inside the
 * admin layout.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { TEMPLATE_ROOT, renderPage, renderView, escapeHtml } from "../render.js";
import { Csrf } from "../auth-legacy/csrf.js";
import { SESSION_COOKIE, SessionManager } from "../auth-legacy/session-manager.js";
import type { Clock, LegacySessionContext, Row, SessionStore } from "../auth-legacy/types.js";
import type { AdminDependencies } from "./types.js";

export const systemClock: Clock = { now: () => Math.floor(Date.now() / 1000) };

/** Request scoped helpers handed to every admin handler. */
export interface AdminContext {
  request: FastifyRequest;
  reply: FastifyReply;
  session: LegacySessionContext;
  user: Row;
  body: Record<string, unknown>;
  query: Record<string, unknown>;
  params: Record<string, string>;
  csrfToken: string;
  /** True when the posted `_csrf` matches the session token. */
  csrfValid(): boolean;
  /** Verify CSRF; on failure flashes + redirects to the login page. */
  requireCsrf(): Promise<boolean>;
  flash(message: string, type?: "success" | "error" | "warning"): void;
  redirect(url: string, message?: string, type?: "success" | "error" | "warning"): Promise<FastifyReply>;
  render(view: string, data?: Record<string, unknown>, status?: number): Promise<FastifyReply>;
  json(payload: unknown, status?: number): FastifyReply;
  audit(action: string, objectType?: string, objectId?: string, metadata?: Record<string, unknown>): Promise<void>;
}

export type AdminHandler = (context: AdminContext) => Promise<unknown>;

interface Registration {
  method: "GET" | "POST";
  url: string;
  handler: AdminHandler;
}

/** Parses `application/x-www-form-urlencoded` payloads (Fastify ships no form parser). */
export function parseFormBody(raw: string): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(raw)) {
    if (key.endsWith("[]")) {
      const name = key.slice(0, -2);
      const existing = output[name];
      if (Array.isArray(existing)) existing.push(value);
      else output[name] = [value];
      continue;
    }
    const previous = output[key];
    if (previous === undefined) output[key] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else output[key] = [previous, value];
  }
  return output;
}

/**
 * Registers the admin routes. Returns the same app for chaining.
 */
export class AdminRouter {
  readonly deps: AdminDependencies;
  private readonly sessions: SessionManager;
  private readonly csrf: NonNullable<AdminDependencies["csrf"]>;
  private readonly secure: boolean;
  private readonly routes: Registration[] = [];

  constructor(private readonly app: FastifyInstance, deps: AdminDependencies) {
    this.deps = deps;
    this.sessions = new SessionManager(deps.sessions, deps.clock ?? systemClock);
    this.csrf = deps.csrf ?? Csrf;
    this.secure = deps.secureCookies ?? false;
    if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
      app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
        done(null, parseFormBody(String(body)));
      });
    }
  }

  get(url: string, handler: AdminHandler): this {
    this.routes.push({ method: "GET", url, handler });
    return this;
  }

  post(url: string, handler: AdminHandler): this {
    this.routes.push({ method: "POST", url, handler });
    return this;
  }

  /** Binds the collected routes onto Fastify. */
  mount(): void {
    for (const route of this.routes) {
      const run = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
        const context = await this.open(request, reply);
        if (context === null) return reply;
        return route.handler(context);
      };
      if (route.method === "GET") this.app.get(route.url, run);
      else this.app.post(route.url, run);
    }
  }

  // --------------------------------------------------------------- internals

  private async open(request: FastifyRequest, reply: FastifyReply): Promise<AdminContext | null> {
    const session = await this.sessions.start(readSessionCookie(request));
    if (session.isNew) reply.header("set-cookie", this.cookie(session.id));
    request.legacySession = session;

    const user = await this.resolveUser(session);
    const loggedIn = user !== null;
    if (user !== null && !isAdmin(user)) {
      await this.sessions.persist(session);
      await this.renderForbidden(reply, user);
      return null;
    }
    if (!loggedIn) {
      await this.sessions.persist(session);
      const target = request.url.split("?")[0] ?? "/admin";
      reply.code(302).header("location", `${this.loginUrl()}?redirect=${encodeURIComponent(target)}`).send();
      return null;
    }

    const body = normaliseBody(request.body);
    const query = normaliseBody(request.query);
    const params = (request.params ?? {}) as Record<string, string>;
    const admin = user as Row;
    const csrfToken = this.csrf.token(session.data);

    const context: AdminContext = {
      request,
      reply,
      session,
      user: admin,
      body,
      query,
      params,
      csrfToken,
      csrfValid: () => {
        const supplied = typeof body["_csrf"] === "string" ? body["_csrf"] : headerCsrf(request);
        return this.csrf.verify(session.data, supplied);
      },
      requireCsrf: async () => {
        const supplied = typeof body["_csrf"] === "string" ? body["_csrf"] : headerCsrf(request);
        if (this.csrf.verify(session.data, supplied)) return true;
        context.flash("会话已过期，请重新操作。", "error");
        await context.redirect(this.loginUrl());
        return false;
      },
      flash: (message, type = "success") => {
        this.sessions.flash(session, message, type === "error" ? "error" : "success");
        if (type === "warning") session.data.flash = { message, type: "warning" };
      },
      redirect: async (url, message, type = "success") => {
        if (message !== undefined) {
          session.data.flash = { message, type };
          session.dirty = true;
        }
        reply.header("location", url);
        await this.sessions.persist(session);
        if (message !== undefined) {
          reply.header("x-flash-message", Buffer.from(message, "utf8").toString("base64"));
          reply.header("x-flash-type", type);
        }
        return reply.code(303).send();
      },
      render: async (view, data = {}, status = 200) => {
        const flash = this.sessions.takeFlash(session);
        const token = this.csrf.token(session.data);
        const badges = { voicehub: await this.failedDeliveries() };
        await this.sessions.persist(session);
        return renderPage(
          reply,
          `admin/${view}`,
          {
            pageTitle: "",
            nav: "",
            site: { name: this.deps.config.get("SITE_NAME", "VoiceHubPay"), url: this.appUrl() },
            currentUser: admin,
            flash,
            csrf: token,
            badges,
            ...data,
          },
          { layout: "admin", status },
        );
      },
      json: (payload, status = 200) => reply.code(status).header("content-type", "application/json; charset=utf-8").send(JSON.stringify(payload)),
      audit: async (action, objectType = "", objectId = "", metadata = {}) => {
        if (this.deps.audit === undefined) return;
        await this.deps.audit.log(
          Number(admin["id"]),
          action,
          objectType,
          objectId,
          metadata,
          request.ip,
          typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
        );
      },
    };
    return context;
  }

  /** Port of AuthService::user() — active account + admin idle timeout. */
  private async resolveUser(session: LegacySessionContext): Promise<Row | null> {
    const raw = session.data["user_id"];
    if (raw === undefined || raw === null) return null;
    const id = Number(raw);
    if (!Number.isSafeInteger(id)) return null;
    const user = await this.deps.users.findById(id);
    if (user === null || String(user["status"] ?? "") !== "active") {
      delete session.data["user_id"];
      delete session.data["admin_last_seen_at"];
      session.dirty = true;
      return null;
    }
    if (isAdmin(user)) {
      const timeout = Math.max(10, this.deps.config.int("SECURITY_ADMIN_SESSION_MINUTES", 120)) * 60;
      const lastSeenRaw = session.data["admin_last_seen_at"];
      const clock = this.deps.clock ?? systemClock;
      const lastSeen = lastSeenRaw === undefined || lastSeenRaw === null ? clock.now() : Number(lastSeenRaw);
      if (clock.now() - lastSeen > timeout) {
        delete session.data["user_id"];
        delete session.data["admin_last_seen_at"];
        session.dirty = true;
        return null;
      }
      session.data["admin_last_seen_at"] = clock.now();
      session.dirty = true;
    } else {
      delete session.data["admin_last_seen_at"];
    }
    return user;
  }

  private async renderForbidden(reply: FastifyReply, user: Row): Promise<void> {
    const userLabel = escapeHtml(String(user["display_name"] ?? "") || String(user["username"] ?? ""));
    const template = path.join(TEMPLATE_ROOT, "errors", "403.ejs");
    if (existsSync(template)) {
      const layout = existsSync(path.join(TEMPLATE_ROOT, "layouts", "shop.ejs")) ? "shop" : null;
      const html = await renderView(
        "errors/403",
        { pageTitle: "403", user: userLabel, year: new Date().getFullYear() },
        { layout },
      );
      reply.code(403).header("content-type", "text/html; charset=utf-8").send(html);
      return;
    }
    reply
      .code(403)
      .header("content-type", "text/html; charset=utf-8")
      .send(
        `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>403 Forbidden</title></head>` +
          `<body><h1>403 Forbidden</h1><p>当前账号没有管理员权限。</p><p><a href="/">返回首页</a></p></body></html>`,
      );
  }

  private async failedDeliveries(): Promise<number> {
    try {
      return await this.deps.voicehubDeliveries.countFailedRetryable();
    } catch {
      return 0;
    }
  }

  private appUrl(): string {
    const config = this.deps.config;
    if (config.appUrl !== undefined) return config.appUrl();
    return config.get("SITE_URL", config.get("APP_URL", "")).replace(/\/+$/, "");
  }

  private loginUrl(): string {
    const config = this.deps.config;
    return config.authUrl !== undefined ? config.authUrl("/login") : "/login";
  }

  private cookie(id: string): string {
    return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax${this.secure ? "; Secure" : ""}`;
  }
}

/* ------------------------------------------------------------------ helpers */

export function isAdmin(user: Row | null): boolean {
  if (user === null) return false;
  const role = String(user["role"] ?? "");
  return role === "admin" || role === "superadmin";
}

export function readSessionCookie(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${SESSION_COOKIE}=`)) {
      const value = trimmed.slice(SESSION_COOKIE.length + 1);
      return value === "" ? null : value;
    }
  }
  return null;
}

function headerCsrf(request: FastifyRequest): string | null {
  const header = request.headers["x-csrf-token"];
  return typeof header === "string" ? header : null;
}

function normaliseBody(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/* ---------------------------------------------------------- form utilities */

/** `Request::string()` equivalent: trimmed? No — PHP string() keeps the raw value. */
export function formString(body: Record<string, unknown>, key: string, fallback = ""): string {
  const value = body[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return fallback;
}

export function formTrimmed(body: Record<string, unknown>, key: string, fallback = ""): string {
  return formString(body, key, fallback).trim();
}

export function formInt(body: Record<string, unknown>, key: string, fallback = 0): number {
  const raw = formString(body, key);
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function formFloat(body: Record<string, unknown>, key: string, fallback = 0): number {
  const raw = formString(body, key).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function formBool(body: Record<string, unknown>, key: string): boolean {
  const raw = formString(body, key).trim().toLowerCase();
  return raw === "1" || raw === "on" || raw === "true" || raw === "yes";
}

/** Reads `key[]` checkbox groups (also tolerates a single scalar). */
export function formList(body: Record<string, unknown>, key: string): string[] {
  const value = body[key] ?? body[`${key}[]`];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string" && value !== "") return [value];
  return [];
}

/** Page number + page count like the PHP controllers (`max(1, int)`). */
export function pagination(query: Record<string, unknown>, perPage: number, total: number): { page: number; pages: number } {
  const page = Math.max(1, formInt(query, "page", 1));
  const pages = Math.ceil(total / Math.max(1, perPage));
  return { page, pages };
}

/** `strlen`-style UTF-16 length is good enough for the documented limits. */
export function codePointLength(value: string): number {
  return [...value].length;
}
