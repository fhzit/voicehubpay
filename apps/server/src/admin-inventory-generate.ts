import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "../../../packages/db/src/index.js";
import type { CryptoService } from "../../../packages/db/src/legacy/crypto.js";
import { generateCodes, MAX_COUNT, MAX_LENGTH, MIN_COUNT, MIN_LENGTH, type CodeMode } from "../../../packages/db/src/legacy/code-generator.js";
import { insertGeneratedCodes } from "../../../packages/db/src/legacy/inventory-repository.js";
import { Csrf } from "./auth-legacy/csrf.js";
import { SESSION_COOKIE, SessionManager } from "./auth-legacy/session-manager.js";
import type { AuditPort, Clock, LegacySessionContext, Row, SessionStore } from "./auth-legacy/types.js";

/**
 * POST /admin/inventory/generate — bulk-generate inventory card codes.
 *
 * Mirrors the PHP admin inventory flow: admin + CSRF are re-verified on every
 * POST, the product must exist and use stock (`card` / `card_and_voicehub`),
 * generated codes are encrypted exactly like a manual import
 * (`insertGeneratedCodes`), the action is written to the audit log, and the
 * browser is redirected 303 back to /admin/inventory?product_id=<id> with a
 * session flash message.
 *
 * Form fields:
 *   product_id     product to attach cards to
 *   count          number of codes, 1..5000
 *   mode           random | pattern
 *   length         body length, 4..64 (default 16)
 *   charset        alnum | alpha | numeric | upper | lower | hex | custom
 *   custom_charset literal charset for mode=pattern / charset=custom
 *   prefix         optional fixed prefix
 *   suffix         optional fixed suffix
 *   note           operator note (audit metadata)
 *   _csrf          CSRF token (or X-CSRF-Token header)
 */

export interface InventoryGenerateProductsPort {
  findById(id: number): Promise<Row | null>;
}

export interface InventoryGenerateUsersPort {
  findById(id: number): Promise<Row | null>;
}

export interface InventoryGenerateDependencies {
  db: Database;
  products: InventoryGenerateProductsPort;
  users: InventoryGenerateUsersPort;
  sessions: SessionStore;
  audit: AuditPort;
  crypto: CryptoService;
  clock?: Clock;
  secureCookies?: boolean;
  /** Login path for unauthenticated redirects (defaults to /login). */
  loginPath?: string;
}

const MAX_NOTE_LENGTH = 200;
const STOCK_DELIVERY_MODES = new Set(["card", "card_and_voicehub"]);

function formString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Strict non-negative integer; empty/invalid -> fallback. */
function formInt(value: unknown, fallback = 0): number {
  const raw = formString(value);
  if (raw === "" || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

/** application/x-www-form-urlencoded support (Fastify only ships JSON/text). */
function ensureFormBodyParser(app: FastifyInstance): void {
  if (app.hasContentTypeParser("application/x-www-form-urlencoded")) return;
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      // Same field semantics as the admin router parser (repeated names and
      // `name[]` both become arrays) so installing this route first cannot
      // degrade other admin forms.
      const parsed: Record<string, unknown> = {};
      for (const [key, value] of new URLSearchParams(String(body))) {
        if (key.endsWith("[]")) {
          const name = key.slice(0, -2);
          const existing = parsed[name];
          if (Array.isArray(existing)) existing.push(value);
          else parsed[name] = [value];
          continue;
        }
        const previous = parsed[key];
        if (previous === undefined) parsed[key] = value;
        else if (Array.isArray(previous)) previous.push(value);
        else parsed[key] = [previous, value];
      }
      done(null, parsed);
    },
  );
}

export function registerInventoryGenerateRoutes(app: FastifyInstance, deps: InventoryGenerateDependencies): void {
  ensureFormBodyParser(app);

  const sessions = new SessionManager(deps.sessions, deps.clock ?? { now: () => Math.floor(Date.now() / 1000) });
  const secure = deps.secureCookies ?? false;
  const loginPath = deps.loginPath ?? "/login";
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
    return context;
  };

  const redirectTo = (reply: FastifyReply, url: string): FastifyReply =>
    reply.code(303).header("location", url).send();

  const redirectWithFlash = async (
    reply: FastifyReply,
    context: LegacySessionContext,
    url: string,
    message: string,
    type: "success" | "error" = "success",
  ): Promise<FastifyReply> => {
    sessions.flash(context, message, type);
    await sessions.persist(context);
    reply.header("x-flash-message", Buffer.from(message, "utf8").toString("base64"));
    reply.header("x-flash-type", type);
    return redirectTo(reply, url);
  };

  const currentUser = async (context: LegacySessionContext): Promise<Row | null> => {
    const id = context.data["user_id"];
    if (id === null || id === undefined) return null;
    const user = await deps.users.findById(Number(id));
    if (user === null || String(user["status"] ?? "") !== "active") return null;
    return user;
  };

  const requireAdmin = async (
    request: FastifyRequest,
    reply: FastifyReply,
    context: LegacySessionContext,
  ): Promise<Row | null> => {
    const user = await currentUser(context);
    if (user === null) {
      await sessions.persist(context);
      reply
        .code(302)
        .header("location", `${loginPath}?redirect=${encodeURIComponent("/admin/inventory")}`)
        .send();
      return null;
    }
    const role = String(user["role"] ?? "");
    if (role !== "admin" && role !== "superadmin") {
      reply.code(403).type("text/plain; charset=utf-8").send("Forbidden");
      return null;
    }
    return user;
  };

  const csrfValid = (request: FastifyRequest, context: LegacySessionContext): boolean => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const header = request.headers["x-csrf-token"];
    const token = typeof body["_csrf"] === "string" ? body["_csrf"] : typeof header === "string" ? header : null;
    return Csrf.verify(context.data, token);
  };

  app.post("/admin/inventory/generate", async (request, reply) => {
    const context = await startSession(request, reply);

    const user = await requireAdmin(request, reply, context);
    if (user === null) return reply;

    if (!csrfValid(request, context)) {
      await sessions.persist(context);
      reply.header("x-flash-message", Buffer.from("会话已过期，请重新操作。", "utf8").toString("base64"));
      reply.header("x-flash-type", "error");
      return reply.code(403).type("text/plain; charset=utf-8").send("CSRF token invalid");
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const productId = formInt(body["product_id"]);
    const backToList = productId > 0 ? `/admin/inventory?product_id=${productId}` : "/admin/inventory";

    if (productId <= 0) {
      return redirectWithFlash(reply, context, "/admin/inventory", "请选择商品。", "error");
    }

    const product = await deps.products.findById(productId);
    if (product === null) {
      return redirectWithFlash(reply, context, "/admin/inventory", "商品不存在。", "error");
    }
    if (!STOCK_DELIVERY_MODES.has(String(product["delivery_mode"] ?? ""))) {
      return redirectWithFlash(reply, context, backToList, "该商品不使用库存，无法生成卡密。", "error");
    }

    const countRaw = formString(body["count"]);
    const lengthRaw = formString(body["length"]);
    const count = formInt(body["count"], -1);
    const length = lengthRaw === "" ? 16 : formInt(body["length"], -1);
    if (countRaw === "" || count < MIN_COUNT || count > MAX_COUNT) {
      return redirectWithFlash(reply, context, backToList, `生成数量必须是 ${MIN_COUNT} 到 ${MAX_COUNT} 之间的整数。`, "error");
    }
    if (length < MIN_LENGTH || length > MAX_LENGTH) {
      return redirectWithFlash(reply, context, backToList, `卡密长度必须是 ${MIN_LENGTH} 到 ${MAX_LENGTH} 之间的整数。`, "error");
    }

    const modeRaw = formString(body["mode"]) || "random";
    if (modeRaw !== "random" && modeRaw !== "pattern") {
      return redirectWithFlash(reply, context, backToList, "不支持的生成模式，可选值：random、pattern。", "error");
    }
    const mode = modeRaw as CodeMode;

    // Accept the UI vocabulary too: the form posts `digits`, the generator
    // speaks `numeric`. Normalising server-side keeps the endpoint usable
    // without JavaScript (the template also rewrites it client-side).
    const charsetAliases: Record<string, string> = { digits: "numeric", number: "numeric", letters: "alpha" };
    const requestedCharset = (formString(body["charset"]) || "alnum").toLowerCase();
    const charset = charsetAliases[requestedCharset] ?? requestedCharset;
    const customCharset = formString(body["custom_charset"]);
    const prefix = formString(body["prefix"]);
    const suffix = formString(body["suffix"]);
    const note = formString(body["note"]);
    if (note.length > MAX_NOTE_LENGTH) {
      return redirectWithFlash(reply, context, backToList, `备注不能超过 ${MAX_NOTE_LENGTH} 个字符。`, "error");
    }

    let codes: string[];
    try {
      codes = generateCodes({ count, mode, length, charset, customCharset, prefix, suffix });
    } catch (error) {
      const message = error instanceof Error ? error.message : "卡密生成失败。";
      return redirectWithFlash(reply, context, backToList, message, "error");
    }

    let result: { inserted: number; duplicates: number };
    try {
      result = await insertGeneratedCodes(deps.db, {
        productId,
        codes,
        note,
        actorId: Number(user["id"]),
        crypto: deps.crypto,
      });
    } catch (error) {
      const message = error instanceof Error ? `卡密写入失败：${error.message}` : "卡密写入失败。";
      return redirectWithFlash(reply, context, backToList, message, "error");
    }

    try {
      await deps.audit.log(
        Number(user["id"]),
        "inventory.generate",
        "product",
        String(productId),
        {
          requested: codes.length,
          inserted: result.inserted,
          duplicates: result.duplicates,
          mode,
          length,
          charset,
          prefix,
          suffix,
          note,
        },
        request.ip,
        String(request.headers["user-agent"] ?? ""),
      );
    } catch {
      // Card insertion already succeeded; a failed audit entry must not turn
      // the request into an apparent failure. The server log carries the 500.
    }

    const message = `生成完成：新增 ${result.inserted} 条，重复跳过 ${result.duplicates} 条。`;
    return redirectWithFlash(reply, context, backToList, message, "success");
  });
}
