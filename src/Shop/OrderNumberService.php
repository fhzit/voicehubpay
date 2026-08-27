<?php

declare(strict_types=1);

namespace VoiceHubPay\Shop;

/**
 * Public order number generator.
 *
 * Format: VH + YYYYMMDD + 8 random base36 chars (unpredictable, does not
 * expose user id or database id). Example: VH20260826ABC123XY.
 */
final class OrderNumberService
{
    private const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public static function generate(?\DateTimeInterface $when = null): string
    {
        $dt = $when ?? new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $rand = '';
        for ($i = 0; $i < 8; $i++) {
            $rand .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }
        return 'VH' . $dt->format('Ymd') . $rand;
    }

    /**
     * Unit number (and shop-order-no VoiceHub code) for a unit.
     */
    public static function unitNo(string $orderNo, int $index): string
    {
        return $orderNo . '-' . str_pad((string) $index, 3, '0', STR_PAD_LEFT);
    }
}
