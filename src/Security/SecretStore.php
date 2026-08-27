<?php

declare(strict_types=1);

namespace VoiceHubPay\Security;

use VoiceHubPay\Config\SettingsRepository;

/**
 * Encrypts/decrypts sensitive application settings (merchant private key,
 * OAuth AppKeys, VoiceHub/Afdian tokens) at rest via APP_MASTER_KEY + libsodium.
 *
 * Sensitive values are never echoed back to the admin UI.
 */
final class SecretStore
{
    public function __construct(
        private readonly string $basePath,
        private readonly SettingsRepository $settings,
    ) {
    }

    public function crypto(): CryptoService
    {
        return new CryptoService($this->basePath);
    }

    /**
     * Read + decrypt a secret setting. Falls back to raw legacy plaintext if
     * the stored value was never encrypted.
     */
    public function get(string $key, ?string $default = null): ?string
    {
        $raw = $this->settings->get($key);
        if ($raw === null || $raw === '') {
            return $default;
        }
        // Legacy plaintext values (written before encryption) are returned as-is.
        if (!str_starts_with($raw, 'v1:')) {
            return $raw;
        }
        try {
            return $this->crypto()->decrypt($raw);
        } catch (\Throwable) {
            return $default;
        }
    }

    /**
     * Encrypt and persist a secret setting. Empty string clears it.
     */
    public function set(string $key, ?string $value): void
    {
        if ($value === null || $value === '') {
            $this->settings->set($key, '');
            return;
        }
        $this->settings->set($key, $this->crypto()->encrypt($value));
    }

    /**
     * True when a secret is configured (even if placeholder "••••••••").
     */
    public function isConfigured(string $key): bool
    {
        $raw = $this->settings->get($key);
        return $raw !== null && $raw !== '';
    }

    /**
     * Return a masked placeholder for the UI. Never returns the real secret.
     */
    public function placeholder(string $key): string
    {
        return $this->isConfigured($key) ? '••••••••' : '';
    }
}
