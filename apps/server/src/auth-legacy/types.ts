import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Shared types for the legacy (PHP-parity) auth/account module.
 *
 * The ports mirror VoiceHubPay\* PHP classes 1:1 — row shapes stay snake_case
 * like the legacy schema, and error strings stay byte-identical to PHP.
 */

/** Legacy-schema row (database/migrations/*.sql). */
export type Row = Record<string, unknown>;

/** Seconds since the Unix epoch — injectable for deterministic tests. */
export interface Clock {
  now(): number;
}

export function systemClock(): Clock {
  return { now: () => Math.floor(Date.now() / 1000) };
}

/** Config surface used by the ported services (App->config). */
export interface ConfigPort {
  get(key: string, fallback?: string): string;
  bool(key: string, fallback: boolean): boolean;
  int(key: string, fallback: number): number;
  /** Effective entry path, honouring a configured secret prefix. */
  authUrl(route: string): string;
}

/** Port of VoiceHubPay\Repositories\UserRepository (the surface used here). */
export interface UserRepositoryPort {
  findById(id: number): Promise<Row | null>;
  findByUsername(username: string): Promise<Row | null>;
  create(data: Row): Promise<Row | null>;
  update(id: number, fields: Row): Promise<void>;
  setPassword(id: number, passwordHash: string): Promise<void>;
  touchLastLogin(id: number): Promise<void>;
  isSuperAdmin(id: number): Promise<boolean>;
}

/** Port of VoiceHubPay\Repositories\SocialIdentityRepository. */
export interface SocialIdentityRepositoryPort {
  findByIdentity(provider: string, socialUid: string): Promise<Row | null>;
  listForUser(userId: number): Promise<Row[]>;
  getProvider(userId: number, provider: string): Promise<Row | null>;
  bind(userId: number, provider: string, socialUid: string, nickname?: string, avatarUrl?: string): Promise<Row | null>;
  unbind(userId: number, provider: string): Promise<boolean>;
  loginMethodCount(user: Row): Promise<number>;
}

/** Port of VoiceHubPay\Security\LoginThrottle (clock injected by adapter). */
export interface ThrottlePort {
  isLocked(key: string): Promise<boolean>;
  recordFailure(key: string): Promise<void>;
  clear(key: string): Promise<void>;
  remaining(key: string): Promise<number>;
}

/** Normalized third-party profile (SocialAuth::exchangeCode output). */
export interface SocialProfile {
  [key: string]: unknown;
  social_uid: string;
  nickname: string;
  avatar_url: string;
}

/**
 * Provider adapter seam. The PHP baseline talks to the 任性聚合登录 platform;
 * adapters (real or stubbed) implement these two calls. authorizeUrl returns
 * the one-time state alongside the URL so the route can stash it in the
 * session exactly like SocialAuth::authorizeUrl does in PHP.
 */
export interface SocialAuthorizeResult {
  url: string;
  state: string;
}

export interface SocialAuthProvider {
  authorizeUrl(provider: string, redirectAfter: string): Promise<SocialAuthorizeResult>;
  exchangeCode(provider: string, code: string): Promise<SocialProfile>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

/** Port of OrderRepository surface used by the account views. */
export interface OrdersPort {
  listForUser(userId: number, status?: string, q?: string, page?: number, perPage?: number): Promise<Paginated<Row>>;
  listForUserLatest(userId: number, limit?: number): Promise<Row[]>;
}

/** Port of FulfillmentUnitRepository surface used by the account views. */
export interface UnitsPort {
  listForUser(userId: number, status?: string, q?: string, page?: number, perPage?: number): Promise<Paginated<Row>>;
  countDeliveredForUser(userId: number): Promise<number>;
}

export interface AuditPort {
  log(userId: number | null, action: string, objectType?: string, objectId?: string, metadata?: Record<string, unknown>, ip?: string | null, userAgent?: string | null): Promise<void>;
}

/** Port of CryptoService surface used by the cards view. */
export interface CryptoPort {
  decrypt(cipher: string): string;
  mask(value: string): string;
}

/** Result shape shared by all AuthService methods (`['ok','error','user']`). */
export interface AuthResult {
  ok: boolean;
  error: string;
  user: Row | null;
  needs_signup?: boolean;
  profile?: SocialProfile;
  already_bound?: boolean;
}

/** $_SESSION-shaped payload persisted per browser session. */
export type SessionData = Record<string, unknown>;

/** Port of the PHP session handler's persistence (sessions table). */
export interface SessionStore {
  load(id: string): Promise<SessionData | null>;
  create(id: string, data: SessionData): Promise<void>;
  save(id: string, data: SessionData): Promise<void>;
  destroy(id: string): Promise<void>;
}

/** Everything the route configurators need. Account-only members optional. */
export interface LegacyAuthDependencies {
  users: UserRepositoryPort;
  social: SocialIdentityRepositoryPort;
  throttle: ThrottlePort;
  sessions: SessionStore;
  socialProvider: SocialAuthProvider;
  config: ConfigPort;
  clock?: Clock;
  secureCookies?: boolean;
  orders?: OrdersPort;
  units?: UnitsPort;
  audit?: AuditPort;
  crypto?: CryptoPort;
}

declare module "fastify" {
  interface FastifyRequest {
    legacySession?: import("./types.js").LegacySessionContext;
  }
}

export interface LegacySessionContext {
  id: string;
  data: SessionData;
  isNew: boolean;
  dirty: boolean;
  destroyedIds: string[];
}

export type LegacyHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
