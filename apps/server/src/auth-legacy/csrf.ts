import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionData } from "./types.js";

/**
 * Port of VoiceHubPay\Security\Csrf.
 *
 * PHP stores one token per session ($_SESSION['csrf_token']) and verifies
 * state-changing POSTs with hash_equals. Same semantics here: the token lives
 * in the session data (sessions table), generated lazily, compared in constant
 * time.
 */
export class Csrf {
  static TOKEN_KEY = "csrf_token";

  /** Current token, generating and persisting one when absent. */
  static token(session: SessionData): string {
    const existing = session[Csrf.TOKEN_KEY];
    if (typeof existing === "string" && existing !== "") return existing;
    const token = randomBytes(32).toString("hex");
    session[Csrf.TOKEN_KEY] = token;
    return token;
  }

  /** Hidden-input markup, matching Csrf::field(). */
  static field(session: SessionData): string {
    return `<input type="hidden" name="_csrf" value="${Csrf.escape(Csrf.token(session))}">`;
  }

  static verify(session: SessionData | null | undefined, token: string | null | undefined): boolean {
    if (token === null || token === undefined || token === "") return false;
    const expected = session?.[Csrf.TOKEN_KEY];
    if (typeof expected !== "string" || expected === "") return false;
    return Csrf.secureCompare(expected, token);
  }

  /** hash_equals equivalent. */
  static secureCompare(expected: string, supplied: string): boolean {
    const left = Buffer.from(expected, "utf8");
    const right = Buffer.from(supplied, "utf8");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }

  private static escape(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#039;");
  }
}
