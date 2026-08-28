<?php

declare(strict_types=1);

namespace VoiceHubPay\Shop;

/**
 * Public order number generator.
 *
 * Format: YYYYMMDDHHMMSSuuuuuu + 4 random digits = 24 numeric chars
 * (14-char second timestamp + 6-char microseconds + 4 random digits).
 * Example: 20260828123456 123456 7890
 *
 * Uniqueness is guaranteed by the caller (ShopService::uniqueOrderNo retries
 * against the orders.order_no UNIQUE constraint). The microsecond-precision
 * timestamp plus random suffix makes collisions impossible for realistic
 * order rates, even across many concurrent orders in the same second.
 * Pure digits: safe for payment gateways, parsing, and display.
 */
final class OrderNumberService
{
    public static function generate(?\DateTimeInterface $when = null): string
    {
        $dt = $when ?? new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $rand = '';
        for ($i = 0; $i < 4; $i++) {
            $rand .= (string) random_int(0, 9);
        }
        return $dt->format('YmdHisu') . $rand;
    }

    /**
     * Unit number (and shop-order-no VoiceHub code) for a unit.
     */
    public static function unitNo(string $orderNo, int $index): string
    {
        return $orderNo . '-' . str_pad((string) $index, 3, '0', STR_PAD_LEFT);
    }
}
