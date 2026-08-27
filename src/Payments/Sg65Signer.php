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
        $key = openssl_pkey_get_private($merchantPrivateKey);
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
        $key = openssl_pkey_get_public($platformPublicKey);
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
}
