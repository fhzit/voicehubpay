<?php

declare(strict_types=1);

namespace VoiceHubPay\Analytics;

use PDO;
use VoiceHubPay\App;
use VoiceHubPay\Support\TimeRange;

/**
 * Live dashboard KPIs and trend charts computed from the real ledgers.
 */
final class DashboardService
{
    public function __construct(private readonly App $app)
    {
    }

    private function pdo(): PDO
    {
        return $this->app->db->pdo();
    }

    /**
     * KPI block for a range, with previous-period comparison.
     */
    public function kpis(string $range, string $channel, string $customFrom = '', string $customTo = ''): array
    {
        $tz = $this->app->config->timezone();
        $period = TimeRange::resolve($range, $customFrom, $customTo, $tz);
        $current = $this->computeKpi($period['from'], $period['to'], $channel);
        $previous = $this->computeKpi($period['previous_from'], $period['previous_to'], $channel);

        $delta = static function (int|float $cur, int|float $prev): float {
            if ($prev == 0) {
                return $cur == 0 ? 0.0 : 100.0;
            }
            return round(((float) $cur - (float) $prev) / (float) $prev * 100, 1);
        };

        $current['deltas'] = [
            'total_revenue' => $delta($current['total_revenue'], $previous['total_revenue']),
            'shop_revenue' => $delta($current['shop_revenue'], $previous['shop_revenue']),
            'afdian_revenue' => $delta($current['afdian_revenue'], $previous['afdian_revenue']),
            'paid_orders' => $delta($current['paid_orders'], $previous['paid_orders']),
            'sold_units' => $delta($current['sold_units'], $previous['sold_units']),
            'voicehub_requests' => $delta($current['voicehub_requests'], $previous['voicehub_requests']),
            'voicehub_success_rate' => $delta($current['voicehub_success_rate'], $previous['voicehub_success_rate']),
        ];
        $current['period'] = $period;
        $current['previous'] = $previous;
        return $current;
    }

    /**
     * Compute the KPI set for one [from,to] window.
     */
    public function computeKpi(string $from, string $to, string $channel = 'all'): array
    {
        $pdo = $this->pdo();
        $shop = in_array($channel, ['all', 'shop'], true);
        $afdian = in_array($channel, ['all', 'afdian'], true);

        $shopRevenue = 0;
        $shopOrders = 0;
        $soldUnits = 0;
        if ($shop) {
            $stmt = $pdo->prepare("SELECT COALESCE(SUM(o.amount_paid_cents),0) AS rev, COUNT(*) AS cnt FROM orders o WHERE o.source='shop' AND o.payment_status='paid' AND o.paid_at >= ? AND o.paid_at <= ?");
            $stmt->execute([$from, $to]);
            $row = $stmt->fetch();
            $shopRevenue = (int) $row['rev'];
            $shopOrders = (int) $row['cnt'];

            $s = $pdo->prepare("SELECT COALESCE(SUM(oi.quantity),0) AS u FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.source='shop' AND o.payment_status='paid' AND o.paid_at >= ? AND o.paid_at <= ?");
            $s->execute([$from, $to]);
            $soldUnits = (int) $s->fetchColumn();
        }

        $afdianRevenue = 0;
        $afdianOrders = 0;
        if ($afdian) {
            $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount_cents),0) AS rev, COUNT(*) AS cnt FROM afdian_orders WHERE status IN ('paid','2') AND paid_at >= ? AND paid_at <= ?");
            $stmt->execute([$from, $to]);
            $row = $stmt->fetch();
            $afdianRevenue = (int) $row['rev'];
            $afdianOrders = (int) $row['cnt'];
        }

        $totalRevenue = $shopRevenue + $afdianRevenue;
        $paidOrders = $shopOrders + $afdianOrders;

        $vh = $this->voicehubStats($from, $to, $channel);
        $vhRequests = $vh['requests'];
        $vhSuccess = $vh['success'];
        $vhFailed = $vh['failed'];
        $vhRate = $vhRequests > 0 ? round($vhSuccess / $vhRequests * 100, 1) : 0.0;

        $manual = 0;
        if ($shop) {
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id WHERE fu.status='manual_completed' AND fu.fulfilled_at >= ? AND fu.fulfilled_at <= ?");
            $stmt->execute([$from, $to]);
            $manual = (int) $stmt->fetchColumn();
        }

        $abnormal = 0;
        if ($shop) {
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM orders o WHERE o.source='shop' AND o.payment_status='paid' AND o.fulfillment_status='failed' AND o.updated_at >= ? AND o.updated_at <= ?");
            $stmt->execute([$from, $to]);
            $abnormal = (int) $stmt->fetchColumn();
        }

        return [
            'total_revenue' => $totalRevenue,
            'shop_revenue' => $shopRevenue,
            'afdian_revenue' => $afdianRevenue,
            'paid_orders' => $paidOrders,
            'shop_orders' => $shopOrders,
            'afdian_orders' => $afdianOrders,
            'sold_units' => $soldUnits,
            'avg_order_value' => $paidOrders > 0 ? (int) round($totalRevenue / $paidOrders) : 0,
            'voicehub_requests' => $vhRequests,
            'voicehub_success' => $vhSuccess,
            'voicehub_failed' => $vhFailed,
            'voicehub_success_rate' => $vhRate,
            'manual_completed' => $manual,
            'abnormal_orders' => $abnormal,
        ];
    }

    private function voicehubStats(string $from, string $to, string $channel): array
    {
        $pdo = $this->pdo();
        $sql = 'SELECT status, COUNT(*) AS c FROM voicehub_deliveries WHERE created_at >= ? AND created_at <= ?';
        $params = [$from, $to];
        if ($channel === 'shop') {
            $sql .= " AND source_type IN ('shop','manual')";
        } elseif ($channel === 'afdian') {
            $sql .= " AND source_type = 'afdian'";
        }
        $sql .= ' GROUP BY status';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $stats = ['requests' => 0, 'success' => 0, 'failed' => 0];
        $total = 0;
        foreach ($stmt->fetchAll() as $row) {
            $total += (int) $row['c'];
            if ($row['status'] === 'success') {
                $stats['success'] = (int) $row['c'];
            } elseif ($row['status'] === 'failed') {
                $stats['failed'] = (int) $row['c'];
            }
        }
        $stats['requests'] = $total;
        return $stats;
    }

    /**
     * Trend data bucketed for charts.
     */
    public function trends(string $range, string $channel, string $customFrom = '', string $customTo = ''): array
    {
        $tz = $this->app->config->timezone();
        $buckets = TimeRange::buckets($range, $customFrom, $customTo, $tz);

        $income = [];
        $orders = [];
        $sold = [];
        $voicehub = [];
        $shopPct = 0;
        $afdianPct = 0;

        $totalIncome = 0;
        $totalShop = 0;
        $totalAfdian = 0;

        // Channel filter: the trend buckets must honor the selected channel
        // just like the KPI cards do; otherwise clicking 商城/爱发电 has no
        // effect on the income trend chart.
        $includeShop = in_array($channel, ['all', 'shop'], true);
        $includeAfdian = in_array($channel, ['all', 'afdian'], true);

        foreach ($buckets as $bucket) {
            $from = $bucket['from'];
            $to = $bucket['to'];
            $shopRev = 0;
            $afdianRev = 0;
            $shopOrders = 0;
            $afdianOrders = 0;
            $units = 0;
            $vh = ['success' => 0, 'failed' => 0, 'requests' => 0];

            if ($includeShop) {
                $stmt = $this->pdo()->prepare("SELECT o.source, COALESCE(SUM(o.amount_paid_cents),0) AS rev, COUNT(*) AS cnt FROM orders o WHERE o.payment_status='paid' AND o.paid_at >= ? AND o.paid_at <= ? GROUP BY o.source");
                $stmt->execute([$from, $to]);
                foreach ($stmt->fetchAll() as $row) {
                    if ($row['source'] === 'shop') {
                        $shopRev = (int) $row['rev'];
                        $shopOrders = (int) $row['cnt'];
                    }
                }
                $s = $this->pdo()->prepare("SELECT COALESCE(SUM(oi.quantity),0) AS u FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.source='shop' AND o.payment_status='paid' AND o.paid_at >= ? AND o.paid_at <= ?");
                $s->execute([$from, $to]);
                $units = (int) $s->fetchColumn();
            }

            if ($includeAfdian) {
                $a = $this->pdo()->prepare("SELECT COALESCE(SUM(amount_cents),0) AS rev, COUNT(*) AS cnt FROM afdian_orders WHERE status IN ('paid','2') AND paid_at >= ? AND paid_at <= ?");
                $a->execute([$from, $to]);
                $aRow = $a->fetch();
                $afdianRev = (int) $aRow['rev'];
                $afdianOrders = (int) $aRow['cnt'];
            }

            $v = $this->pdo()->prepare('SELECT status, COUNT(*) AS c FROM voicehub_deliveries WHERE created_at >= ? AND created_at <= ? GROUP BY status');
            $v->execute([$from, $to]);
            $vCount = 0;
            foreach ($v->fetchAll() as $vRow) {
                $vCount += (int) $vRow['c'];
                if ($vRow['status'] === 'success') {
                    $vh['success'] = (int) $vRow['c'];
                } elseif ($vRow['status'] === 'failed') {
                    $vh['failed'] = (int) $vRow['c'];
                }
            }
            $vh['requests'] = $vCount;

            $income[] = ['label' => $bucket['label'], 'total' => $shopRev + $afdianRev, 'shop' => $shopRev, 'afdian' => $afdianRev];
            $orders[] = ['label' => $bucket['label'], 'shop' => $shopOrders, 'afdian' => $afdianOrders];
            $sold[] = ['label' => $bucket['label'], 'units' => $units];
            $voicehub[] = ['label' => $bucket['label'], 'success' => $vh['success'], 'failed' => $vh['failed']];

            $totalIncome += $shopRev + $afdianRev;
            $totalShop += $shopRev;
            $totalAfdian += $afdianRev;
        }

        if ($totalIncome > 0) {
            $shopPct = round($totalShop / $totalIncome * 100, 1);
            $afdianPct = round($totalAfdian / $totalIncome * 100, 1);
        }

        return [
            'income' => $income,
            'orders' => $orders,
            'sold' => $sold,
            'voicehub' => $voicehub,
            'source_pct' => ['shop' => $shopPct, 'afdian' => $afdianPct],
            'totals' => ['total' => $totalIncome, 'shop' => $totalShop, 'afdian' => $totalAfdian],
        ];
    }

    public function productRanking(string $orderBy = 'revenue', int $limit = 10): array
    {
        $sort = $orderBy === 'units' ? 'sold_units DESC' : 'revenue_cents DESC';
        $sql = "SELECT p.id, p.name, p.price_cents, p.cover_image,
                    (SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status='paid') AS paid_orders,
                    (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status='paid') AS sold_units,
                    (SELECT COALESCE(SUM(oi.quantity * oi.product_price_cents_snapshot),0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status='paid') AS revenue_cents,
                    (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status='available') AS stock_available
                FROM products p
                WHERE p.status != 'draft'
                ORDER BY " . $sort . ' LIMIT ' . (int) $limit;
        return $this->pdo()->query($sql)->fetchAll();
    }

    public function inventoryOverview(): array
    {
        $rows = $this->pdo()->query("SELECT status, COUNT(*) AS c FROM inventory_cards GROUP BY status")->fetchAll();
        $stats = ['available' => 0, 'reserved' => 0, 'sold' => 0, 'disabled' => 0];
        foreach ($rows as $row) {
            $stats[$row['status']] = (int) $row['c'];
        }
        return $stats;
    }

    public function voicehubSourceBreakdown(): array
    {
        $rows = $this->pdo()->query("SELECT code_source, status, COUNT(*) AS c FROM voicehub_deliveries GROUP BY code_source, status")->fetchAll();
        $out = ['inventory' => ['total' => 0, 'success' => 0, 'failed' => 0], 'shop_order_no' => ['total' => 0, 'success' => 0, 'failed' => 0], 'afdian_order_no' => ['total' => 0, 'success' => 0, 'failed' => 0]];
        foreach ($rows as $row) {
            if (!isset($out[$row['code_source']])) {
                continue;
            }
            $out[$row['code_source']]['total'] += (int) $row['c'];
            if ($row['status'] === 'success') {
                $out[$row['code_source']]['success'] += (int) $row['c'];
            } elseif ($row['status'] === 'failed') {
                $out[$row['code_source']]['failed'] += (int) $row['c'];
            }
        }
        return $out;
    }
}
