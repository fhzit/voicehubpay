<?php

declare(strict_types=1);

namespace VoiceHubPay\Support;

/**
 * Safe decimal-string <-> cents conversion. NEVER uses (float)$amount * 100.
 */
final class Money
{
    /**
     * Convert a decimal string (e.g. "10.00", "5", "0.50") to integer cents.
     *
     * @throws \InvalidArgumentException on malformed input
     */
    public static function toCents(string|int|float $value): int
    {
        if (is_int($value)) {
            // Assume already cents.
            return $value;
        }
        $raw = trim((string) $value);
        if ($raw === '') {
            throw new \InvalidArgumentException('金额为空');
        }
        // Strip thousands separators and whitespace.
        $raw = str_replace([',', ' ', "\u{00A0}"], '', $raw);
        if (!preg_match('/^-?(\d+)(\.(\d{1,2}))?$/', $raw, $m)) {
            throw new \InvalidArgumentException('无效的金额格式: ' . $raw);
        }
        $negative = str_starts_with($raw, '-');
        $whole = ltrim($m[1], '0');
        $frac = $m[3] ?? '';
        $frac = str_pad(substr($frac, 0, 2), 2, '0');
        $cents = (int) $whole * 100 + (int) $frac;
        return $negative ? -$cents : $cents;
    }

    public static function format(int $cents): string
    {
        $sign = $cents < 0 ? '-' : '';
        $cents = abs($cents);
        return $sign . intdiv($cents, 100) . '.' . str_pad((string) ($cents % 100), 2, '0', STR_PAD_LEFT);
    }
}
