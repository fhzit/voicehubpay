/// <reference path="../sodium-native.d.ts" />
import { createHash, randomBytes } from 'node:crypto';
import sodium from 'sodium-native';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Port of VoiceHubPay\Security\CryptoService.
 *
 * Uses the PHP-compatible libsodium secretbox primitive and key derivation.
 * The wire format, `v1:` prefix, master-key file (storage/.masterkey, 0600,
 * hex key >= 32 chars) and the one-way SHA-256 `hash()` used for card dedup /
 * lookup are preserved.
 *
 * Card codes are stored as ciphertext + a plaintext SHA-256 hash (for
 * lookup/dedup only; the hash is one-way and cannot reveal the code).
 */
export class CryptoService {
  static readonly PREFIX = 'v1:';
  private key: string | null = null;

  constructor(private readonly basePath: string) {}

  /** Returns the raw master key. Creates it if missing (install time). */
  masterKey(): string {
    if (this.key !== null) return this.key;
    const file = join(this.basePath, 'storage', '.masterkey');
    if (existsSync(file)) {
      const key = readFileSync(file, 'utf8');
      if (key.trim().length >= 32) {
        this.key = key.trim();
        return this.key;
      }
    }
    // Generate & persist.
    const key = randomBytes(32).toString('hex');
    mkdirSync(dirname(file), { recursive: true, mode: 0o775 });
    writeFileSync(file, key, { flag: 'w' });
    try { chmodSync(file, 0o600); } catch { /* best effort */ }
    this.key = key;
    return this.key;
  }

  masterKeyConfigured(): boolean {
    const file = join(this.basePath, 'storage', '.masterkey');
    if (!existsSync(file)) return false;
    return readFileSync(file, 'utf8').trim().length >= 32;
  }

  private derivedKey(): Uint8Array {
    // PHP sodium_crypto_generichash($masterKey, '', KEYBYTES): unkeyed BLAKE2b.
    const hash = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES);
    sodium.crypto_generichash(hash, Buffer.from(this.masterKey(), 'utf8'));
    return hash;
  }

  encrypt(plain: string): string {
    const nonce = randomBytes(sodium.crypto_secretbox_NONCEBYTES);
    const message = Buffer.from(plain, 'utf8');
    const sealed = Buffer.alloc(message.length + sodium.crypto_secretbox_MACBYTES);
    sodium.crypto_secretbox_easy(sealed, message, nonce, this.derivedKey());
    return `${CryptoService.PREFIX}${Buffer.concat([nonce, Buffer.from(sealed)]).toString('base64')}`;
  }

  decrypt(cipher: string): string {
    if (!cipher.startsWith(CryptoService.PREFIX)) {
      // Legacy plaintext value — return as-is (caller may re-encrypt).
      return cipher;
    }
    const encoded = cipher.slice(CryptoService.PREFIX.length);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Invalid ciphertext payload');
    const raw = Buffer.from(encoded, 'base64');
    const nonceBytes = sodium.crypto_secretbox_NONCEBYTES;
    if (raw.length < nonceBytes + sodium.crypto_secretbox_MACBYTES) throw new Error('Invalid ciphertext payload');
    const nonce = raw.subarray(0, nonceBytes);
    const sealed = raw.subarray(nonceBytes);
    const plain = Buffer.alloc(sealed.length - sodium.crypto_secretbox_MACBYTES);
    if (!sodium.crypto_secretbox_open_easy(plain, sealed, nonce, this.derivedKey())) {
      throw new Error('Invalid ciphertext payload');
    }
    return Buffer.from(plain).toString('utf8');
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(CryptoService.PREFIX);
  }

  hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  /** Mask a card code for safe display: SG82****A1. */
  mask(value: string, prefix = 4, suffix = 2): string {
    const trimmed = value.trim();
    const len = [...trimmed].length;
    if (len <= prefix + suffix) return '*'.repeat(len);
    const chars = [...trimmed];
    return chars.slice(0, prefix).join('') + '*'.repeat(Math.max(4, len - prefix - suffix)) + chars.slice(-suffix).join('');
  }
}
