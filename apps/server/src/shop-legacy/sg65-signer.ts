import { createSign, createVerify, createPrivateKey, createPublicKey, KeyObject } from "node:crypto";

/**
 * Port of VoiceHubPay\Payments\Sg65Signer (SG65 V2 RSA/SHA256 helpers).
 *
 * Signing: read all non-empty scalar params, exclude sign/sign_type, sort by
 * param name ASCII ascending, build "a=b&c=d&e=f" (values unchanged), sign
 * SHA256WithRSA with the merchant RSA private key.
 *
 * Verification: dynamically read the ACTUAL returned fields (never a
 * hard-coded whitelist), exclude sign/sign_type and empty values, sort, build,
 * verify with the platform RSA public key.
 */

/**
 * Build the canonical query string from a param map.
 * Non-string/non-number values (arrays etc.) are skipped like PHP arrays.
 */
export function buildString(params: Record<string, unknown>): string {
  const pairs: Array<[string, string]> = [];
  for (const [rawKey, value] of Object.entries(params)) {
    const key = String(rawKey);
    if (key === "sign" || key === "sign_type") continue;
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "string") {
      pairs.push([key, value]);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      pairs.push([key, numberToPhpString(value)]);
      continue;
    }
    if (typeof value === "boolean") {
      pairs.push([key, value ? "1" : ""]);
      continue;
    }
    // Arrays / objects / nested values are excluded (PHP is_array/resource skip).
    continue;
  }
  // PHP ksort(..., SORT_STRING): byte-wise ASCII ascending by key.
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function numberToPhpString(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

/** Normalize a bare base64 or PEM key into a full PEM (port of Sg65Signer::toPem). */
export function toPem(key: string, labels: string[]): string {
  const trimmed = key.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed;
  const base64 = trimmed.replace(/\s+/g, "");
  if (base64 === "") return key;
  const body = (base64.match(/.{1,64}/g) ?? []).join("\n") + "\n";
  for (const label of labels) {
    const pem = `-----BEGIN ${label}-----\n${body}-----END ${label}-----`;
    try {
      if (label.includes("PRIVATE")) {
        createPrivateKey(pem);
      } else {
        createPublicKey(pem);
      }
      return pem;
    } catch {
      // try the next label
    }
  }
  return `-----BEGIN ${labels[0]}-----\n${body}-----END ${labels[0]}-----`;
}

function privateKeyObject(key: string, operation: "sign" | "verify"): KeyObject | null {
  try {
    const pem = toPem(key, ["PRIVATE KEY", "RSA PRIVATE KEY"]);
    const parsed = createPrivateKey(pem);
    return parsed.asymmetricKeyType === undefined && parsed.type !== "private" ? null : parsed;
  } catch {
    void operation;
    return null;
  }
}

function publicKeyObject(key: string): KeyObject | null {
  try {
    const pem = toPem(key, ["PUBLIC KEY", "RSA PUBLIC KEY"]);
    return createPublicKey(pem);
  } catch {
    return null;
  }
}

/** Sign params with the merchant RSA private key (SHA256WithRSA). Throws Error on invalid key. */
export function sign(params: Record<string, unknown>, merchantPrivateKey: string): string {
  const key = privateKeyObject(merchantPrivateKey, "sign");
  if (key === null) throw new Error("SG65 商户私钥无效。");
  const signer = createSign("RSA-SHA256");
  signer.update(buildString(params));
  return signer.sign(key).toString("base64");
}

/** Verify a response/notify param set with the platform RSA public key. */
export function verify(params: Record<string, unknown>, platformPublicKey: string): boolean {
  const signature = typeof params["sign"] === "string" ? params["sign"] : "";
  if (signature === "") return false;
  const key = publicKeyObject(platformPublicKey);
  if (key === null) return false;
  let raw: Buffer;
  try {
    raw = Buffer.from(signature, "base64");
    // PHP base64_decode(..., true) strictness: reject invalid base64.
    const round = raw.toString("base64").replace(/=+$/, "");
    if (round !== signature.replace(/=+$/, "")) return false;
  } catch {
    return false;
  }
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(buildString(params));
    return verifier.verify(key, raw);
  } catch {
    return false;
  }
}
