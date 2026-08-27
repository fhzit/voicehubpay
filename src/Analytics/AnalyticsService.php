<?php

declare(strict_types=1);

namespace VoiceHubPay\Analytics;

use VoiceHubPay\App;

/**
 * Daily analytics aggregation cache. This is ONLY a cache — the real ledgers
 * are orders, payment_transactions, afdian_orders and voicehub_deliveries.
 */
final class AnalyticsService
{
    public function __construct(private readonly App $app)
    {
    }

    /**
     * Recompute one day (Shanghai) from the real ledgers.
     * Upserts analytics_daily rows per channel.
     */
    public function aggregateDay(string $date): void
    {
        $pdo = $this->app->db->pdo();
        $from = (new \DateTimeImmutable($date . ' 00:00:00', new \DateTimeZone('Asia/Shanghai')))->setTimezone(new \DateTimeZone('UTC'))->format('c');
        $to = (new \DateTimeImmutable($date . ' 23:59:59', new \DateTimeZone('Asia/Shanghai')))->setTimezone(new \DateTimeZone('UTC'))->format('c');
        $updated = gmdate('c');

        // ---- Shop channel (from orders + items + units + deliveries) ----
        $shop = $pdo->prepare("SELECT
            COALESCE(SUM(o.amount_paid_cents),0) AS revenue_cents,
            COUNT(*) AS paid_orders,
            COALESCE(SUM(oi.quantity),0) AS sold_units
            FROM orders o JOIN order_items oi ON oi.order_id = o.id
            WHERE o.source = 'shop' AND o.payment_status = 'paid' AND o.paid_at >= ? AND o.paid_at <= ?");
        $shop->execute([$from, $to]);
        $shopRow = $shop->fetch();

        $shopUnits = $pdo->prepare("SELECT fu.status, COUNT(*) AS c FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id WHERE o.source='shop' AND o.payment_status='paid' AND fu.created_at >= ? AND fu.created_at <= ? GROUP BY fu.status");
        $shopUnits->execute([$from, $to]);
        $unitStats = ['success' => 0, 'failed' => 0, 'manual_completed' => 0];
        foreach ($shopUnits->fetchAll() as $r) {
            if (isset($unitStats[$r['status']])) {
                $unitStats[$r['status']] = (int) $r['c'];
            }
        }

        $shopVh = $pdo->prepare("SELECT vd.status, COUNT(*) AS c FROM voicehub_deliveries vd JOIN fulfillment_units fu ON fu.id = vd.fulfillment_unit_id JOIN orders o ON o.id = fu.order_id WHERE o.source='shop' AND vd.created_at >= ? AND vd.created_at <= ? GROUP BY vd.status");
        $shopVh->execute([$from, $to]);
        $vhStats = ['success' => 0, 'failed' => 0];
        foreach ($shopVh->fetchAll() as $r) {
            if (isset($vhStats[$r['status']])) {
                $vhStats[$r['status']] = (int) $r['c'];
            }
        }

        $this->upsert($date, 'shop', [
            'revenue_cents' => (int) $shopRow['revenue_cents'],
            'paid_orders' => (int) $shopRow['paid_orders'],
            'sold_units' => (int) $shopRow['sold_units'],
            'fulfilled_units' => (int) $unitStats['success'],
            'failed_units' => (int) $unitStats['failed'],
            'voicehub_success' => (int) $vhStats['success'],
            'voicehub_failed' => (int) $vhStats['failed'],
            'manual_completed' => (int) $unitStats['manual_completed'],
            'updated_at' => $updated,
        ]);

        // ---- Afdian channel ----
        $afdian = $pdo->prepare("SELECT COALESCE(SUM(amount_cents),0) AS revenue_cents, COUNT(*) AS paid_orders FROM afdian_orders WHERE status IN ('paid','2') AND paid_at >= ? AND paid_at <= ?");
        $afdian->execute([$from, $to]);
        $afdianRow = $afdian->fetch();

        $afdianVh = $pdo->prepare("SELECT vd.status, COUNT(*) AS c FROM voicehub_deliveries vd WHERE vd.source_type='afdian' AND vd.created_at >= ? AND vd.created_at <= ? GROUP BY vd.status");
        $afdianVh->execute([$from, $to]);
        $afdVh = ['success' => 0, 'failed' => 0];
        foreach ($afdianVh->fetchAll() as $r) {
            if (isset($afdVh[$r['status']])) {
                $afdVh[$r['status']] = (int) $r['c'];
            }
        }

        $this->upsert($date, 'afdian', [
            'revenue_cents' => (int) $afdianRow['revenue_cents'],
            'paid_orders' => (int) $afdianRow['paid_orders'],
            'sold_units' => (int) $afdianRow['paid_orders'],
            'fulfilled_units' => (int) $afdVh['success'],
            'failed_units' => (int) $afdVh['failed'],
            'voicehub_success' => (int) $afdVh['success'],
            'voicehub_failed' => (int) $afdVh['failed'],
            'manual_completed' => 0,
            'updated_at' => $updated,
        ]);

        // ---- Manual channel (manual_completed units) ----
        $manual = $pdo->prepare("SELECT COUNT(*) AS c FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id WHERE fu.status='manual_completed' AND fu.fulfilled_at >= ? AND fu.fulfilled_at <= ?");
        $manual->execute([$from, $to]);
        $this->upsert($date, 'manual', [
            'revenue_cents' => 0,
            'paid_orders' => 0,
            'sold_units' => 0,
            'fulfilled_units' => 0,
            'failed_units' => 0,
            'voicehub_success' => 0,
            'voicehub_failed' => 0,
            'manual_completed' => (int) $manual->fetchColumn(),
            'updated_at' => $updated,
        ]);

        // New users
        $users = $pdo->prepare('SELECT COUNT(*) FROM users WHERE created_at >= ? AND created_at <= ?');
        $users->execute([$from, $to]);
        $this->upsert($date, 'shop', ['new_users' => (int) $users->fetchColumn(), 'updated_at' => $updated], true);
    }

    /**
     * Aggregate a date span (inclusive). Returns the dates processed.
     */
    public function aggregateRange(string $fromDate, string $toDate): array
    {
        $dates = [];
        $cursor = new \DateTimeImmutable($fromDate);
        $end = new \DateTimeImmutable($toDate);
        $guard = 0;
        while ($cursor <= $end && $guard < 2000) {
            $this->aggregateDay($cursor->format('Y-m-d'));
            $dates[] = $cursor->format('Y-m-d');
            $cursor = $cursor->modify('+1 day');
            $guard++;
        }
        return $dates;
    }

    /**
     * Rebuild the whole cache from the ledgers.
     */
    public function rebuild(): int
    {
        $pdo = $this->app->db->pdo();
        $pdo->exec('DELETE FROM analytics_daily');
        $min = (string) $pdo->query('SELECT MIN(paid_at) FROM orders WHERE payment_status = \'paid\'')->fetchColumn();
        $minA = (string) $pdo->query("SELECT MIN(paid_at) FROM afdian_orders WHERE status IN ('paid','2')")->fetchColumn();
        if ($min === '' || $min === null || $min === false) {
            $min = $minA;
        }
        if ($min === '' || $min === null || $min === false) {
            $min = gmdate('c');
        }
        $fromDate = (new \DateTimeImmutable($min))->setTimezone(new \DateTimeZone('Asia/Shanghai'))->format('Y-m-d');
        $toDate = (new \DateTimeImmutable('now', new \DateTimeZone('Asia/Shanghai')))->format('Y-m-d');
        return count($this->aggregateRange($fromDate, $toDate));
    }

    public function lastRebuild(): ?string
    {
        return $this->app->config->get('ANALYTICS_LAST_REBUILD');
    }

    public function markRebuilt(): void
    {
        $this->app->config->settings()->set('ANALYTICS_LAST_REBUILD', gmdate('c'));
    }

    private function upsert(string $date, string $channel, array $fields, bool $merge = false): void
    {
        $pdo = $this->app->db->pdo();
        $existing = $pdo->prepare('SELECT * FROM analytics_daily WHERE date = ? AND channel = ?');
        $existing->execute([$date, $channel]);
        $row = $existing->fetch();
        $values = $fields;
        if ($merge && $row) {
            foreach ($fields as $k => $v) {
                $values[$k] = (int) ($row[$k] ?? 0) + (int) $v;
            }
        }
        $columns = ['date', 'channel', 'revenue_cents', 'paid_orders', 'sold_units', 'fulfilled_units', 'failed_units', 'voicehub_success', 'voicehub_failed', 'manual_completed', 'new_users', 'updated_at'];
        $data = [
            $date, $channel,
            (int) ($values['revenue_cents'] ?? 0),
            (int) ($values['paid_orders'] ?? 0),
            (int) ($values['sold_units'] ?? 0),
            (int) ($values['fulfilled_units'] ?? 0),
            (int) ($values['failed_units'] ?? 0),
            (int) ($values['voicehub_success'] ?? 0),
            (int) ($values['voicehub_failed'] ?? 0),
            (int) ($values['manual_completed'] ?? 0),
            (int) ($values['new_users'] ?? 0),
            (string) ($values['updated_at'] ?? gmdate('c')),
        ];
        if ($row) {
            $placeholders = implode(', ', array_map(static fn ($c) => "$c = ?", $columns));
            $stmt = $pdo->prepare('UPDATE analytics_daily SET ' . $placeholders . ' WHERE date = ? AND channel = ?');
            $stmt->execute(array_merge($data, [$date, $channel]));
        } else {
            $stmt = $pdo->prepare('INSERT INTO analytics_daily (' . implode(', ', $columns) . ') VALUES (' . implode(', ', array_fill(0, count($columns), '?')) . ')');
            $stmt->execute($data);
        }
    }
}
