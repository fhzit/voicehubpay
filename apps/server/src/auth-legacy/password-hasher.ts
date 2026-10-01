import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * Port of VoiceHubPay\Security\PasswordHasher.
 *
 * Divergence from the PHP baseline: PHP uses password_hash(PASSWORD_ARGON2ID).
 * New hashes here are scrypt PHC strings (memory-hard, no native deps beyond
 * Node). Verification additionally accepts legacy PHP `$argon2id$…` rows via
 * the `argon2` package so existing databases keep working. `needsRehash`
 * mirrors PHP semantics: true when a stored hash was not produced with the
 * current parameters.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export class PasswordHasher {
  static async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });
    return ["scrypt", N, R, P, salt.toString("base64"), derived.toString("base64")].join("$");
  }

  static async verify(password: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash) return false;
    if (hash.startsWith("scrypt$")) return PasswordHasher.verifyScrypt(password, hash);
    if (hash.startsWith("$argon2id$")) {
      try {
        const argon2 = (await import("argon2")).default;
        return await argon2.verify(hash, password);
      } catch {
        return false;
      }
    }
    return false;
  }

  static needsRehash(hash: string | null | undefined): boolean {
    if (!hash) return false;
    return !hash.startsWith("scrypt$");
  }

  private static async verifyScrypt(password: string, hash: string): Promise<boolean> {
    const parts = hash.split("$");
    if (parts.length !== 6) return false;
    try {
      const n = Number(parts[1]);
      const r = Number(parts[2]);
      const p = Number(parts[3]);
      const salt = Buffer.from(parts[4]!, "base64");
      const expected = Buffer.from(parts[5]!, "base64");
      const derived = await scrypt(password, salt, expected.length, { N: n, r, p });
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }
}
