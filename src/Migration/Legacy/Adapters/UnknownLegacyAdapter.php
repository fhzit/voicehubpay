<?php

declare(strict_types=1);

namespace VoiceHubPay\Migration\Legacy\Adapters;

use VoiceHubPay\Security\CryptoService;

/**
 * Refuses to migrate schemas we cannot recognize. Never guesses field mappings.
 */
final class UnknownLegacyAdapter implements LegacyAdapter
{
    public static function name(): string
    {
        return 'UnknownLegacy';
    }

    public static function supports(array $columns): bool
    {
        return false;
    }

    public static function amountColumn(): string
    {
        return 'amount';
    }

    public static function voicehubColumn(): string
    {
        return 'voicehub_status';
    }

    public function mapRow(array $legacy, CryptoService $crypto): array
    {
        throw new \RuntimeException('Unknown legacy schema — refusing to guess field mappings.');
    }
}
