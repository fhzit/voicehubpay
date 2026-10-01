import { PasswordHasher } from "./password-hasher.js";
import type {
  AuthResult,
  Clock,
  ConfigPort,
  Row,
  SocialIdentityRepositoryPort,
  SocialProfile,
  UserRepositoryPort,
} from "./types.js";

/**
 * Faithful port of VoiceHubPay\Auth\AuthService (439 lines).
 *
 * Every branch, validation message and ordering decision mirrors the PHP
 * baseline; error strings are byte-identical. Session concerns (login/logout/
 * rotation, admin timeout) live in the routes/session layer — see routes.ts —
 * except `loginUser` bookkeeping (touchLastLogin + admin_last_seen_at) which
 * is expressed as the session mutation the PHP method performed.
 */
export class AuthService {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly social: SocialIdentityRepositoryPort,
    private readonly config: ConfigPort,
    private readonly clock: Clock,
  ) {}

  /**
   * Port of AuthService::user() — resolves and validates the session user.
   * Takes/returns raw session data so the caller owns persistence.
   */
  async user(session: Record<string, unknown>): Promise<Row | null> {
    const id = session["user_id"];
    if (id === null || id === undefined) return null;
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId)) return null;
    const user = await this.users.findById(numericId);
    if (user === null || user["status"] !== "active") {
      delete session["user_id"];
      delete session["admin_last_seen_at"];
      return null;
    }
    const role = String(user["role"] ?? "");
    if (role === "admin" || role === "superadmin") {
      const timeoutMinutes = Math.max(10, this.config.int("SECURITY_ADMIN_SESSION_MINUTES", 120));
      const timeout = timeoutMinutes * 60;
      const lastSeenRaw = session["admin_last_seen_at"];
      const lastSeen = lastSeenRaw === undefined || lastSeenRaw === null ? this.clock.now() : Number(lastSeenRaw);
      if (this.clock.now() - lastSeen > timeout) {
        delete session["user_id"];
        delete session["admin_last_seen_at"];
        return null;
      }
      session["admin_last_seen_at"] = this.clock.now();
    } else {
      delete session["admin_last_seen_at"];
    }
    return user;
  }

  async isLoggedIn(session: Record<string, unknown>): Promise<boolean> {
    return (await this.user(session)) !== null;
  }

  async isAdmin(session: Record<string, unknown>): Promise<boolean> {
    const user = await this.user(session);
    if (user === null) return false;
    const role = String(user["role"] ?? "");
    return role === "admin" || role === "superadmin";
  }

  /** True when the logged-in user is the first-created admin. */
  async isSuperAdmin(session: Record<string, unknown>): Promise<boolean> {
    const user = await this.user(session);
    if (user === null) return false;
    const role = String(user["role"] ?? "");
    if (!(role === "admin" || role === "superadmin")) return false;
    return this.users.isSuperAdmin(Number(user["id"]));
  }

  /** Port of AuthService::loginUser() — the session mutation + touch. */
  async loginUser(session: Record<string, unknown>, user: Row): Promise<void> {
    session["user_id"] = Number(user["id"]);
    if (String(user["role"] ?? "") === "admin") {
      session["admin_last_seen_at"] = this.clock.now();
    } else {
      delete session["admin_last_seen_at"];
    }
    await this.users.touchLastLogin(Number(user["id"]));
  }

  /** Port of AuthService::logout() — clear data; rotation handled by caller. */
  logoutData(session: Record<string, unknown>): void {
    delete session["user_id"];
    for (const key of Object.keys(session)) delete session[key];
  }

  /**
   * Password login. Mirrors loginWithPassword(): throttle locks checked first
   * (ip: + user: keys), non-enumerating error, disabled-account check, throttle
   * clear + optional rehash on success.
   */
  async loginWithPassword(
    username: string,
    password: string,
    throttle: { isLocked(key: string): Promise<boolean>; recordFailure(key: string): Promise<void>; clear(key: string): Promise<void> },
    ip: string,
  ): Promise<AuthResult> {
    const ipKey = `ip:${ip}`;
    const userKey = `user:${username.toLowerCase()}`;
    if ((await throttle.isLocked(ipKey)) || (await throttle.isLocked(userKey))) {
      return { ok: false, error: "尝试次数过多，请稍后再试。", user: null };
    }

    const user = await this.users.findByUsername(username);
    if (user === null || !(await PasswordHasher.verify(password, user["password_hash"] as string | null | undefined))) {
      await throttle.recordFailure(ipKey);
      await throttle.recordFailure(userKey);
      return { ok: false, error: "用户名或密码错误。", user: null };
    }
    if (user["status"] !== "active") {
      return { ok: false, error: "该账号已被禁用。", user: null };
    }

    await throttle.clear(ipKey);
    await throttle.clear(userKey);
    const hash = user["password_hash"] as string | null | undefined;
    if (PasswordHasher.needsRehash(hash)) {
      await this.users.setPassword(Number(user["id"]), await PasswordHasher.hash(password));
    }
    return { ok: true, error: "", user };
  }

  /** Register a new user. Validation order and messages mirror PHP. */
  async register(username: string, password: string, confirm: string, displayName = "", accepted = false, email = ""): Promise<AuthResult> {
    if (!this.config.bool("REGISTRATION_ENABLED", true)) {
      return { ok: false, error: "当前未开放注册。", user: null };
    }
    if (!accepted) {
      return { ok: false, error: "请先阅读并同意服务说明。", user: null };
    }
    username = username.trim();
    const usernameError = this.usernameError(username);
    if (usernameError !== "") return { ok: false, error: usernameError, user: null };
    if (password.length < 8) return { ok: false, error: "密码至少需要 8 位。", user: null };
    if (password !== confirm) return { ok: false, error: "两次输入的密码不一致。", user: null };
    if ((await this.users.findByUsername(username)) !== null) {
      return { ok: false, error: "该用户名已被占用。", user: null };
    }
    email = email.trim();
    if (email !== "" && !isEmail(email)) return { ok: false, error: "邮箱格式不正确。", user: null };
    const user = await this.users.create({
      username,
      password_hash: await PasswordHasher.hash(password),
      display_name: displayName !== "" ? displayName : username,
      email,
    });
    return { ok: true, error: "", user };
  }

  /** Update the email on an account. Empty string clears it. */
  async updateEmail(userId: number, email: string): Promise<AuthResult> {
    email = email.trim();
    if (email !== "" && !isEmail(email)) return { ok: false, error: "邮箱格式不正确。", user: null };
    if (codePoints(email).length > 254) return { ok: false, error: "邮箱长度不能超过 254 个字符。", user: null };
    await this.users.update(userId, { email });
    return { ok: true, error: "", user: await this.users.findById(userId) };
  }

  async updateNickname(userId: number, nickname: string): Promise<AuthResult> {
    nickname = nickname.trim();
    if (codePoints(nickname).length > 50) return { ok: false, error: "昵称长度不能超过 50 个字符。", user: null };
    await this.users.update(userId, { display_name: nickname });
    return { ok: true, error: "", user: await this.users.findById(userId) };
  }

  /** Change the username for the given user. */
  async changeUsername(userId: number, username: string): Promise<AuthResult> {
    username = username.trim();
    const error = this.usernameError(username);
    if (error !== "") return { ok: false, error, user: null };
    const existing = await this.users.findByUsername(username);
    if (existing !== null && Number(existing["id"]) !== userId) {
      return { ok: false, error: "该用户名已被占用。", user: null };
    }
    await this.users.update(userId, { username });
    return { ok: true, error: "", user: await this.users.findById(userId) };
  }

  /**
   * Complete a social-only account: set a real username + password. Only
   * accounts without a password may use this one-shot completion.
   */
  async completeUsernamePassword(userId: number, username: string, password: string, confirm: string): Promise<AuthResult> {
    const user = await this.users.findById(userId);
    if (user === null) return { ok: false, error: "账号不存在。", user: null };
    const existingHash = user["password_hash"];
    if (typeof existingHash === "string" && existingHash !== "") {
      return { ok: false, error: "该账号已设置密码，请直接在账号信息中修改。", user: null };
    }
    const usernameResult = await this.changeUsername(userId, username);
    if (!usernameResult.ok) return { ok: false, error: usernameResult.error, user: null };
    if (password.length < 8) return { ok: false, error: "密码至少需要 8 位。", user: null };
    if (password !== confirm) return { ok: false, error: "两次输入的密码不一致。", user: null };
    await this.users.setPassword(userId, await PasswordHasher.hash(password));
    return { ok: true, error: "", user: await this.users.findById(userId) };
  }

  /**
   * Social login: bind by (provider, social_uid) or require first-time signup.
   * Never merges accounts by nickname/avatar; brand-new identities return
   * needs_signup=true with the profile so the caller forces username+password.
   */
  async loginWithSocial(provider: string, profile: Partial<SocialProfile> & Record<string, unknown>): Promise<AuthResult> {
    provider = ["qq", "wx"].includes(provider) ? provider : "qq";
    const socialUid = String(profile["openid"] ?? profile["social_uid"] ?? "");
    if (socialUid === "") return { ok: false, error: "未获取到第三方身份标识。", user: null };
    const nickname = String(profile["nickname"] ?? "");
    const avatar = String(profile["avatar_url"] ?? "");

    const identity = await this.social.findByIdentity(provider, socialUid);
    if (identity !== null) {
      const user = await this.users.findById(Number(identity["user_id"]));
      if (user === null || user["status"] !== "active") {
        return { ok: false, error: "账号不可用。", user: null };
      }
      return { ok: true, error: "", needs_signup: false, user };
    }

    return {
      ok: true,
      error: "",
      needs_signup: true,
      user: null,
      profile: { provider, social_uid: socialUid, nickname, avatar_url: avatar } as unknown as SocialProfile,
    };
  }

  /**
   * Complete a brand-new social signup: create the account with the chosen
   * username + password and bind the identity. Username defaults to the
   * nickname (CJK preserved, padded/derived exactly like PHP).
   */
  async completeSocialSignup(profile: Record<string, unknown>, username: string, password: string, confirm: string, email = ""): Promise<AuthResult> {
    const rawProvider = String(profile["provider"] ?? "");
    const provider = ["qq", "wx"].includes(rawProvider) ? rawProvider : "qq";
    const socialUid = String(profile["social_uid"] ?? "");
    if (socialUid === "") return { ok: false, error: "第三方身份标识缺失，请重新使用 QQ/微信登录。", user: null };
    if ((await this.social.findByIdentity(provider, socialUid)) !== null) {
      return { ok: false, error: "该第三方账号已绑定其他账户，请使用账号密码直接登录。", user: null };
    }

    username = username.trim();
    const nickname = String(profile["nickname"] ?? "");
    if (username === "") {
      // Keep letters/digits/underscore/dash/CJK, cap at 24 chars, pad short
      // nicknames with underscores so the >= 3 char rule still holds.
      let slug = nickname.replace(/[^a-zA-Z0-9_一-龥-]/gu, "").slice(0, 24);
      while (slug !== "" && codePoints(slug).length < 3) slug += "_";
      username = slug !== "" ? slug : `u_${socialUid.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16)}`;
      // Ensure uniqueness preserving CJK (suffixing, random tail after 50).
      let candidate = username;
      let i = 1;
      while ((await this.users.findByUsername(candidate)) !== null) {
        candidate = `${username}_${i}`;
        i += 1;
        if (i > 50) candidate = `${username}_${randomHex(3)}`;
      }
      username = candidate;
    }

    const usernameError = validateUsername(username);
    if (usernameError !== "") return { ok: false, error: usernameError, user: null };
    if ((await this.users.findByUsername(username)) !== null) {
      return { ok: false, error: "该用户名已被占用。", user: null };
    }
    if (password.length < 8) return { ok: false, error: "密码至少需要 8 位。", user: null };
    if (password !== confirm) return { ok: false, error: "两次输入的密码不一致。", user: null };
    email = email.trim();
    if (email !== "" && !isEmail(email)) return { ok: false, error: "邮箱格式不正确。", user: null };

    const user = await this.users.create({
      username,
      password_hash: await PasswordHasher.hash(password),
      display_name: nickname !== "" ? nickname : username,
      avatar_url: String(profile["avatar_url"] ?? ""),
      email,
    });
    await this.social.bind(Number(user!["id"]), provider, socialUid, nickname, String(profile["avatar_url"] ?? ""));
    return { ok: true, error: "", user };
  }

  /**
   * Bind a social identity to the currently logged-in user. Never signs out,
   * switches accounts, or creates accounts.
   */
  async bindToCurrentUser(session: Record<string, unknown>, provider: string, profile: Partial<SocialProfile> & Record<string, unknown>): Promise<AuthResult> {
    provider = ["qq", "wx"].includes(provider) ? provider : "qq";
    const user = await this.user(session);
    if (user === null) return { ok: false, error: "请先登录再绑定。", user: null };
    const socialUid = String(profile["openid"] ?? profile["social_uid"] ?? "");
    if (socialUid === "") return { ok: false, error: "未获取到第三方身份标识。", user: null };
    const existing = await this.social.findByIdentity(provider, socialUid);
    if (existing !== null) {
      if (Number(existing["user_id"]) === Number(user["id"])) {
        return { ok: true, error: "", already_bound: true, user };
      }
      return { ok: false, error: `该${provider === "qq" ? "QQ" : "微信"}账号已绑定到其他账号，无法重复绑定。`, user: null };
    }
    await this.social.bind(Number(user["id"]), provider, socialUid, String(profile["nickname"] ?? ""), String(profile["avatar_url"] ?? ""));
    return { ok: true, error: "", already_bound: false, user };
  }

  /** Shared username validator (registration + username change). */
  private usernameError(username: string): string {
    if (Buffer.byteLength(username, "utf8") < 3 || Buffer.byteLength(username, "utf8") > 32) {
      return "用户名长度需为 3-32 个字符。";
    }
    return /^[a-zA-Z0-9_\-一-龥]+$/u.test(username) ? "" : "用户名仅支持字母、数字、下划线、短横线与中文。";
  }
}

/**
 * PHP `strlen` is bytes: username length limits (3–32) are byte-based in the
 * baseline, so byte length is used. PHP `mb_strlen` is char-based: email max
 * 254 and nickname max 50 use code-point counts.
 */
export function codePoints(value: string): string[] {
  return [...value];
}

export function validateUsername(username: string): string {
  if (Buffer.byteLength(username, "utf8") < 3 || Buffer.byteLength(username, "utf8") > 32) {
    return "用户名长度需为 3-32 个字符。";
  }
  return /^[a-zA-Z0-9_\-一-龥]+$/u.test(username) ? "" : "用户名仅支持字母、数字、下划线、短横线与中文。";
}

/** FILTER_VALIDATE_EMAIL approximation, conservative like PHP's built-in. */
export function isEmail(email: string): boolean {
  if (/\s/.test(email)) return false;
  // Reject obvious PHP-invalid forms; accept the standard shape.
  const pattern = /^(?!-)(?:[A-Za-z0-9-_"!#$%&'*+/=?^`{|}~.]+)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
  return pattern.test(email) && !email.includes("..");
}

function randomHex(bytes: number): string {
  const alphabet = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < bytes * 2; i += 1) out += alphabet[Math.floor(Math.random() * 16)];
  return out;
}
