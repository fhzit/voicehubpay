<?php

declare(strict_types=1);

namespace VoiceHubPay\Migration\Legacy\Adapters;

use VoiceHubPay\Security\CryptoService;
use VoiceHubPay\Support\Money;

/**
 * Contract implemented by every legacy adapter.
 */
interface LegacyAdapter
{
    public static function name(): string;

    /**
     * Whether this adapter can read a table with the given column list.
     */
    public static function supports(array $columns): bool;

    /**
     * The legacy amount column name (for pre-migration stats).
     */
    public static function amountColumn(): string;

    /**
     * The legacy voicehub status column name.
     */
    public static function voicehubColumn(): string;

    /**
     * Map one legacy row to the new afdian_orders row shape.
     *
     * @return array<string, mixed>
     */
    public function mapRow(array $legacy, CryptoService $crypto): array;
}
