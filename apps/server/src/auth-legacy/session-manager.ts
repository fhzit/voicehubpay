import { randomBytes } from "node:crypto";
import { Csrf } from "./csrf.js";
import type { Clock, LegacySessionContext, SessionData, SessionStore } from "./types.js";

/**
 * Session lifecycle for the legacy module, mirroring PHP session semantics:
 *
 * - one row per browser session in the `sessions` table (session_id TEXT PK,
 *   data JSON, created_at, updated_at);
 * - `regenerate() == session_regenerate_id(true)`: a fresh id row is created,
 *   the old row is deleted, the data carries over (used on login and logout);
 * - flash messages live in the session and are consumed on first read, just
 *   like `$this->redirect(...)->withFlash(...)` + the render-time unset.
 */

export const SESSION_COOKIE = "vh_legacy_session";
const SESSION_ID_BYTES = 32;

export class SessionManager {
  constructor(private readonly store: SessionStore, private readonly clock: Clock) {}

  /** Start (or resume) a session from the request cookie. */
  async start(sessionId: string | null | undefined): Promise<LegacySessionContext> {
    if (sessionId) {
      const data = await this.store.load(sessionId);
      if (data !== null) {
        return { id: sessionId, data, isNew: false, dirty: false, destroyedIds: [] };
      }
    }
    const id = this.newSessionId();
    const data: SessionData = {};
    await this.store.create(id, data);
    return { id, data, isNew: true, dirty: false, destroyedIds: [] };
  }

  /** session_regenerate_id(true): new id row, old id deleted, data kept. */
  async regenerate(context: LegacySessionContext): Promise<void> {
    const id = this.newSessionId();
    context.destroyedIds.push(context.id);
    await this.store.destroy(context.id);
    context.id = id;
    await this.store.create(id, context.data);
    context.isNew = true;
  }

  /** Persist mutated session data under the (possibly rotated) id. */
  async persist(context: LegacySessionContext): Promise<void> {
    await this.store.save(context.id, context.data);
    context.dirty = false;
    context.isNew = false;
  }

  /** Terminate the session: clear data and rotate the id (PHP logout). */
  async destroy(context: LegacySessionContext): Promise<void> {
    await this.store.destroy(context.id);
    context.data = {};
    context.destroyedIds.push(context.id);
    const id = this.newSessionId();
    context.id = id;
    await this.store.create(id, context.data);
    context.isNew = true;
  }

  /** Flash write (Controller::flash / Response::withFlash). */
  flash(context: LegacySessionContext, message: string, type: "success" | "error" = "success"): void {
    context.data.flash = { message, type };
    context.dirty = true;
  }

  /** Flash read-and-clear, matching render-time `unset($_SESSION['flash'])`. */
  takeFlash(context: LegacySessionContext): { message: string; type: string } | null {
    const value = context.data.flash;
    if (value === undefined || value === null) return null;
    delete context.data.flash;
    context.dirty = true;
    return value as { message: string; type: string };
  }

  /** Regenerate the CSRF token after an account switch (defence in depth). */
  rotateCsrf(context: LegacySessionContext): string {
    delete context.data[Csrf.TOKEN_KEY];
    context.dirty = true;
    return Csrf.token(context.data);
  }

  newSessionId(): string {
    return randomBytes(SESSION_ID_BYTES).toString("hex");
  }
}
