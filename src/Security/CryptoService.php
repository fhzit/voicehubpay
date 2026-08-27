<?php

declare(strict_types=1);

namespace VoiceHubPay\Security;

/**
 * libsodium secret-box encryption built on APP_MASTER_KEY.
 *
 * - master key is kept in storage/.masterkey (0600), generated at install.
 * - secrets are stored as "v1:<b64(nonce+sealed)>".
 * - card codes are stored as ciphertext + a plaintext SHA-256 hash (for
 *   lookup/dedup only; the hash is one-way and cannot reveal the code).
 */
final class CryptoService
{
    public const PREFIX = 'v1:';

    private ?string $key = null;

    public function __construct(private readonly string $basePath)
    {
    }

    /**
     * Returns the raw master key. Creates it if missing (install time).
     */
    public function masterKey(): string
    {
        if ($this->key !== null) {
            return $this->key;
        }
        $file = $this->basePath . '/storage/.masterkey';
        if (is_file($file)) {
            $key = (string) file_get_contents($file);
            if (strlen($key) >= 32) {
                return $this->key = trim($key);
            }
        }
        // Generate & persist.
        $key = bin2hex(random_bytes(32));
        if (!is_dir(dirname($file))) {
            mkdir(dirname($file), 0775, true);
        }
        file_put_contents($file, $key, LOCK_EX);
        @chmod($file, 0600);
        return $this->key = $key;
    }

    public function masterKeyConfigured(): bool
    {
        $file = $this->basePath . '/storage/.masterkey';
        return is_file($file) && strlen(trim((string) file_get_contents($file))) >= 32;
    }

    public function encrypt(string $plain): string
    {
        $key = sodium_crypto_generichash($this->masterKey(), '', SODIUM_CRYPTO_GENERICHASH_KEYBYTES);
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $sealed = sodium_crypto_secretbox($plain, $nonce, $key);
        return self::PREFIX . base64_encode($nonce . $sealed);
    }

    public function decrypt(string $cipher): string
    {
        if (!str_starts_with($cipher, self::PREFIX)) {
            // Legacy plaintext value — return as-is (caller may re-encrypt).
            return $cipher;
        }
        $raw = base64_decode(substr($cipher, strlen(self::PREFIX)), true);
        if ($raw === false || strlen($raw) < SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
            throw new \RuntimeException('Invalid ciphertext payload');
        }
        $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $sealed = substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $key = sodium_crypto_generichash($this->masterKey(), '', SODIUM_CRYPTO_GENERICHASH_KEYBYTES);
        $plain = sodium_crypto_secretbox_open($sealed, $nonce, $key);
        if ($plain === false) {
            throw new \RuntimeException('Decryption failed (master key mismatch?)');
        }
        return $plain;
    }

    public function isEncrypted(string $value): bool
    {
        return str_starts_with($value, self::PREFIX);
    }

    public function hash(string $value): string
    {
        return hash('sha256', $value);
    }

    /**
     * Mask a card code for safe display: SG82****A1.
     */
    public function mask(string $value, int $prefix = 4, int $suffix = 2): string
    {
        $value = trim($value);
        $len = mb_strlen($value);
        if ($len <= $prefix + $suffix) {
            return str_repeat('*', $len);
        }
        return mb_substr($value, 0, $prefix) . str_repeat('*', max(4, $len - $prefix - $suffix)) . mb_substr($value, -$suffix);
    }
}
