<?php

declare(strict_types=1);

namespace VoiceHubPay\Migration\Legacy\Adapters;

/**
 * Detects the best legacy adapter for a given column set.
 */
final class AdapterRegistry
{
    /** @var array<class-string<LegacyAdapter>> */
    public const ADAPTERS = [
        LegacyV1Adapter::class,
        LegacyV2Adapter::class,
    ];

    /**
     * @return class-string<LegacyAdapter>
     */
    public static function detect(array $columns): string
    {
        foreach (self::ADAPTERS as $adapter) {
            if ($adapter::supports($columns)) {
                return $adapter;
            }
        }
        return UnknownLegacyAdapter::class;
    }
}
