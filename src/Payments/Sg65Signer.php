<?php

declare(strict_types=1);

namespace VoiceHubPay\Payments;

/**
 * SG65 V2 (RSA/SHA256) signing helpers.
 *
 * Signing: read all non-empty scalar params, exclude sign/sign_type, sort by
 * param name ASCII ascending, build "a=b&c=d&e=f" (values unchanged), sign with
 * the merchant RSA private key using SHA256WithRSA.
 *
 * Verification: dynamically read the ACTUAL returned fields (never a hard-coded
 * whitelist), exclude sign/sign_type and empty values, sort, build, verify with
 * the platform RSA public key.
 */
final class Sg65Signer
{
    /**
     * Build the canonical query string from a param array.
     */
    public static function buildString(array $params): string
    {
        $pairs = [];
        foreach ($params as $key => $value) {
            if (is_array($value) || is_resource($value)) {
                continue;
            }
            if ($key === 'sign' || $key === 'sign_type') {
                continue;
            }
            if ($value === null || $value === '') {
                continue;
            }
            $pairs[(string) $key] = (string) $value;
        }
        ksort($pairs, SORT_STRING);
        $parts = [];
        foreach ($pairs as $k => $v) {
            $parts[] = $k . '=' . $v;
        }
        return implode('&', $parts);
    }

    /**
     * Sign params with the merchant RSA private key (SHA256WithRSA).
     *
     * @throws \RuntimeException
     */
    public static function sign(array $params, string $merchantPrivateKey): string
    {
        $key = openssl_pkey_get_private(self::toPem($merchantPrivateKey, 'PRIVATE KEY', 'RSA PRIVATE KEY'));
        if ($key === false) {
            throw new \RuntimeException('SG65 商户私钥无效。');
        }
        $signature = '';
        $ok = openssl_sign(self::buildString($params), $signature, $key, OPENSSL_ALGO_SHA256);
        if (!$ok) {
            throw new \RuntimeException('SG65 签名失败。');
        }
        return base64_encode($signature);
    }

    /**
     * Verify a response/notify param set with the platform RSA public key.
     */
    public static function verify(array $params, string $platformPublicKey): bool
    {
        $signature = (string) ($params['sign'] ?? '');
        if ($signature === '') {
            return false;
        }
        $key = openssl_pkey_get_public(self::toPem($platformPublicKey, 'PUBLIC KEY', 'RSA PUBLIC KEY'));
        if ($key === false) {
            return false;
        }
        $result = openssl_verify(
            self::buildString($params),
            base64_decode($signature, true) ?: '',
            $key,
            OPENSSL_ALGO_SHA256
        );
        return $result === 1;
    }

    /**
     * Normalize a key to PEM. If the value already carries a PEM armor
     * (-----BEGIN ...-----) it is returned untouched. Otherwise the bare
     * base64 body is wrapped in the first label whose PEM OpenSSL accepts.
     *
     * SG65 exposes keys as bare base64 (no armor); OpenSSL needs the PEM
     * wrapper, so a bare key would otherwise fail with "unsupported".
     */
    private static function toPem(string $key, string ...$labels): string
    {
        $key = trim($key);
        if (str_contains($key, '-----BEGIN')) {
            return $key;
        }
        // Strip any incidental whitespace residue.
        $base64 = preg_replace('/\s+/', '', $key);
        if ($base64 === null || $base64 === '') {
            return $key;
        }
        $body = chunk_split($base64, 64, "\n");
        foreach ($labels as $label) {
            $pem = "-----BEGIN {$label}-----\n{$body}-----END {$label}-----";
            $parsed = str_starts_with($label, 'PRIVATE')
                ? openssl_pkey_get_private($pem)
                : openssl_pkey_get_public($pem);
            if ($parsed !== false) {
                return $pem;
            }
        }
        // Fall back to the first label; the caller will turn a parse failure
        // into the proper "无效" error.
        return "-----BEGIN {$labels[0]}-----\n{$body}-----END {$labels[0]}-----";
    }
}
