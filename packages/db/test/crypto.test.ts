import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sodium from "sodium-native";
import { CryptoService } from "../src/legacy/crypto.js";
const roots: string[] = [];
function crypto(key = "voicehub migration master key fixture"): CryptoService { const root = mkdtempSync(join(tmpdir(), "vh-crypto-")); roots.push(root); mkdirSync(join(root, "storage")); writeFileSync(join(root, "storage", ".masterkey"), key); return new CryptoService(root); }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("PHP-compatible secretbox crypto", () => {
 it("decrypts ciphertext formatted as PHP secretbox using PHP key derivation", () => { const key = "voicehub migration master key fixture"; const nonce = Uint8Array.from({length: sodium.crypto_secretbox_NONCEBYTES}, (_, i) => i); const derived = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES); sodium.crypto_generichash(derived, Buffer.from(key)); const message = Buffer.from("legacy PHP card code 你好"); const sealed = Buffer.alloc(message.length + sodium.crypto_secretbox_MACBYTES); sodium.crypto_secretbox_easy(sealed, message, nonce, derived); const fixture = "v1:" + Buffer.concat([Buffer.from(nonce), sealed]).toString("base64"); expect(crypto(key).decrypt(fixture)).toBe("legacy PHP card code 你好"); });
 it("encrypts to secretbox payload decryptable by PHP primitive", () => { const key = "voicehub migration master key fixture"; const service = crypto(key); const encoded = service.encrypt("TS plaintext ✓"); const payload = Buffer.from(encoded.slice(3), "base64"); const nonce = payload.subarray(0, sodium.crypto_secretbox_NONCEBYTES); const sealed = payload.subarray(sodium.crypto_secretbox_NONCEBYTES); const derived = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES); sodium.crypto_generichash(derived, Buffer.from(key)); const plain = Buffer.alloc(sealed.length - sodium.crypto_secretbox_MACBYTES); expect(sodium.crypto_secretbox_open_easy(plain, sealed, nonce, derived)).toBe(true); expect(plain.toString("utf8")).toBe("TS plaintext ✓"); });
});
