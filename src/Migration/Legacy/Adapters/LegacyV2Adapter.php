<?php

declare(strict_types=1);

namespace VoiceHubPay\Migration\Legacy\Adapters;

use VoiceHubPay\Security\CryptoService;
use VoiceHubPay\Support\Money;

/**
 * A later legacy schema that already used out_trade_no + amount_cents naming.
 * out_trade_no is preserved verbatim.
 */
final class LegacyV2Adapter implements LegacyAdapter
{
    public static function name(): string
    {
        return 'LegacyV2';
    }

    public static function supports(array $columns): bool
    {
        return in_array('out_trade_no', $columns, true) && !in_array('order_no', $columns, true);
    }

    public static function amountColumn(): string
    {
        return in_array('amount_cents', (array) (self::$columns ?? []), true) ? 'amount_cents' : 'amount';
    }

    /** @var array|null captured column list for amountColumn resolution */
    private static ?array $columns = null;

    public static function setColumns(array $columns): void
    {
        self::$columns = $columns;
    }

    public static function voicehubColumn(): string
    {
        return 'voicehub_status';
    }

    public function mapRow(array $legacy, CryptoService $crypto): array
    {
        $outTradeNo = (string) ($legacy['out_trade_no'] ?? '');
        if (isset($legacy['amount_cents'])) {
            $amountCents = (int) $legacy['amount_cents'];
        } else {
            try {
                $amountCents = Money::toCents((string) ($legacy['amount'] ?? '0'));
            } catch (\InvalidArgumentException) {
                $amountCents = (int) round((float) ($legacy['amount'] ?? 0) * 100);
            }
        }

        $vhStatus = strtolower((string) ($legacy['voicehub_status'] ?? 'pending'));
        $vhStatus = match (true) {
            $vhStatus === 'created' || $vhStatus === 'success' => 'success',
            $vhStatus === 'failed' => 'failed',
            default => 'pending',
        };

        $created = (string) ($legacy['created_at'] ?? gmdate('c'));
        return [
            'out_trade_no' => $outTradeNo,
            'trade_no' => (string) ($legacy['trade_no'] ?? ''),
            'user_id' => (string) ($legacy['user_id'] ?? ''),
            'plan_id' => (string) ($legacy['plan_id'] ?? ''),
            'sku_detail' => (string) ($legacy['sku_detail'] ?? ''),
            'amount_cents' => $amountCents,
            'status' => (string) ($legacy['status'] ?? 'paid'),
            'raw_payload' => (string) ($legacy['raw_payload'] ?? '[]'),
            'voicehub_status' => $vhStatus,
            'voicehub_attempts' => $vhStatus === 'failed' ? 1 : 0,
            'voicehub_last_error' => $legacy['voicehub_last_error'] ?? $legacy['last_error'] ?? null,
            'created_at' => $created,
            'paid_at' => $created,
            'processed_at' => in_array($vhStatus, ['success', 'failed'], true) ? $created : null,
            'updated_at' => (string) ($legacy['updated_at'] ?? $created),
        ];
    }
}
