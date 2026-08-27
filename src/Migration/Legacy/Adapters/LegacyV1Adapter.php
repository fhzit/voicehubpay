<?php

declare(strict_types=1);

namespace VoiceHubPay\Migration\Legacy\Adapters;

use VoiceHubPay\Security\CryptoService;
use VoiceHubPay\Support\Money;

/**
 * The original voicehubpay schema (the one shipped in this repository):
 *   afdian_orders(id, order_no, afdian_user_id, buyer_name, amount,
 *   status, voicehub_status, voicehub_response, last_error, raw_payload,
 *   created_at, updated_at)
 *
 * KEY RULE: order_no IS the Afdian out_trade_no and must be preserved VERBATIM
 * (no truncation, no numeric conversion, no prefix/suffix).
 */
final class LegacyV1Adapter implements LegacyAdapter
{
    public static function name(): string
    {
        return 'LegacyV1';
    }

    public static function supports(array $columns): bool
    {
        return in_array('order_no', $columns, true) && in_array('amount', $columns, true);
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
        $outTradeNo = (string) ($legacy['order_no'] ?? '');
        $amountRaw = (string) ($legacy['amount'] ?? '0');
        try {
            $amountCents = Money::toCents($amountRaw);
        } catch (\InvalidArgumentException) {
            $amountCents = (int) round((float) $amountRaw * 100);
        }

        $vhStatus = strtolower((string) ($legacy['voicehub_status'] ?? 'pending'));
        $vhStatus = match (true) {
            $vhStatus === 'created' || $vhStatus === 'success' => 'success',
            $vhStatus === 'failed' => 'failed',
            default => 'pending',
        };

        $created = (string) ($legacy['created_at'] ?? gmdate('c'));
        $updated = (string) ($legacy['updated_at'] ?? $created);

        return [
            'out_trade_no' => $outTradeNo,
            'trade_no' => (string) ($legacy['trade_no'] ?? ''),
            'user_id' => (string) ($legacy['afdian_user_id'] ?? ''),
            'plan_id' => (string) ($legacy['plan_id'] ?? ''),
            'sku_detail' => (string) ($legacy['sku_detail'] ?? ''),
            'amount_cents' => $amountCents,
            'status' => (string) ($legacy['status'] ?? 'paid'),
            'raw_payload' => (string) ($legacy['raw_payload'] ?? '[]'),
            'voicehub_status' => $vhStatus,
            'voicehub_attempts' => $vhStatus === 'failed' ? 1 : 0,
            'voicehub_last_error' => $legacy['last_error'] ?? null,
            'created_at' => $created,
            'paid_at' => $created,
            'processed_at' => in_array($vhStatus, ['success', 'failed'], true) ? $created : null,
            'updated_at' => $updated,
        ];
    }
}
