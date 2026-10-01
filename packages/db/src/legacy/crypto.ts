import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Port of VoiceHubPay\Security\CryptoService.
 *
 * Divergence from the PHP baseline: PHP uses libsodium secretbox; the Node
 * runtime has no sodium, so the sealed payload uses AES-256-GCM instead.
 * The wire format, `v1:` prefix, master-key file (storage/.masterkey, 0600,
 * hex key >= 32 chars) and the one-way SHA-256 `hash()` used for card dedup /
 * lookup are all preserved. Ciphertexts are therefore NOT cross-port
 * decryptable with the PHP implementation — migrate-and-decrypt must happen
 * on the same runtime.
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

  private derivedKey(): Buffer {
    // Same derivation idea as PHP: hash the master key down to key length.
    return createHash('sha256').update(this.masterKey()).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.derivedKey(), iv);
    const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return `${CryptoService.PREFIX}${Buffer.concat([iv, sealed]).toString('base64')}`;
  }

  decrypt(cipher: string): string {
    if (!cipher.startsWith(CryptoService.PREFIX)) {
      // Legacy plaintext value — return as-is (caller may re-encrypt).
      return cipher;
    }
    const raw = Buffer.from(cipher.slice(CryptoService.PREFIX.length), 'base64');
    if (raw.length < 12 + 16) throw new Error('Invalid ciphertext payload');
    const iv = raw.subarray(0, 12);
    const body = raw.subarray(12, raw.length - 16);
    const tag = raw.subarray(raw.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', this.derivedKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    return plain.toString('utf8');
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
