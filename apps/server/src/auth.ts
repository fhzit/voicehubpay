import argon2 from "argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { authLoginRequestSchema } from "../../../packages/contracts/src/index.js";

export type AuthUser = Readonly<{ id: string; passwordHash: string }>;
export type SessionRecord = Readonly<{ userId: string; csrfToken: string }>;
export interface UserRepository { findByEmail(email: string): Promise<AuthUser | null> }
export interface SessionRepository {
  create(userId: string, tokenHash: string, csrfToken: string, expiresAt: Date): Promise<void>;
  find(tokenHash: string): Promise<SessionRecord | null>;
  rotate(oldTokenHash: string, newTokenHash: string, csrfToken: string, expiresAt: Date): Promise<boolean>;
  revoke(tokenHash: string): Promise<void>;
}
export interface PasswordVerifier { verify(hash: string, password: string): Promise<boolean> }
export type AuthDependencies = Readonly<{ users: UserRepository; sessions: SessionRepository; passwords: PasswordVerifier }>;
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const cookieName = "vh_session";
const dummyHash = argon2.hash("voicehubpay-invalid-user-dummy", { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const argon2idPasswords: PasswordVerifier = { async verify(hash, password) { try { return await argon2.verify(hash, password); } catch { return false; } } };
export function hashSessionToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function randomToken(): string { return randomBytes(32).toString("base64url"); }
function equalTokens(a: string, b: string): boolean { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function cookie(token: string, secure: boolean): string { return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`; }
function clearedCookie(secure: boolean): string { return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`; }
function readCookie(header: string | undefined): string | null { const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1); return value && /^[A-Za-z0-9_-]{40,}$/.test(value) ? value : null; }
export function configureAuth(app: import("fastify").FastifyInstance, dependencies: AuthDependencies, secure: boolean): void {
 app.post("/api/auth/login", async (request, reply) => {
  const parsed = authLoginRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST", message: "Invalid login request", requestId: request.id });
  const user = await dependencies.users.findByEmail(parsed.data.email.toLowerCase());
  const valid = user ? await dependencies.passwords.verify(user.passwordHash, parsed.data.password) : await dependencies.passwords.verify(await dummyHash, parsed.data.password);
  if (!user || !valid) return reply.code(401).send({ error: "INVALID_CREDENTIALS", message: "Email or password is incorrect" });
  const token = randomToken(); const csrfToken = randomToken();
  await dependencies.sessions.create(user.id, hashSessionToken(token), csrfToken, new Date(Date.now() + SESSION_SECONDS * 1000));
  reply.header("set-cookie", cookie(token, secure)); return reply.code(200).send({ csrfToken });
 });
 app.get("/api/auth/me", async (request, reply) => {
  const token = readCookie(request.headers.cookie); const session = token ? await dependencies.sessions.find(hashSessionToken(token)) : null;
  if (!session) return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Authentication required" });
  return reply.code(200).send({ userId: session.userId });
 });
 app.post("/api/auth/logout", async (request, reply) => {
  const token = readCookie(request.headers.cookie); const session = token ? await dependencies.sessions.find(hashSessionToken(token)) : null;
  if (!token || !session) return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Authentication required" });
  const csrf = request.headers["x-csrf-token"];
  if (typeof csrf !== "string" || !equalTokens(csrf, session.csrfToken)) return reply.code(403).send({ error: "CSRF_INVALID", message: "CSRF validation failed" });
  await dependencies.sessions.revoke(hashSessionToken(token));
  reply.header("set-cookie", clearedCookie(secure));
  return reply.code(200).send({ status: "logged_out" });
 });
 app.post("/api/auth/rotate", async (request, reply) => {
  const token = readCookie(request.headers.cookie); const session = token ? await dependencies.sessions.find(hashSessionToken(token)) : null;
  if (!token || !session) return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Authentication required" });
  const csrf = request.headers["x-csrf-token"];
  if (typeof csrf !== "string" || !equalTokens(csrf, session.csrfToken)) return reply.code(403).send({ error: "CSRF_INVALID", message: "CSRF validation failed" });
  const replacement = randomToken(); const csrfToken = randomToken();
  const rotated = await dependencies.sessions.rotate(hashSessionToken(token), hashSessionToken(replacement), csrfToken, new Date(Date.now() + SESSION_SECONDS * 1000));
  if (!rotated) return reply.code(401).send({ error: "UNAUTHENTICATED", message: "Authentication required" });
  reply.header("set-cookie", cookie(replacement, secure)); return reply.code(200).send({ status: "rotated", csrfToken });
 });
}
