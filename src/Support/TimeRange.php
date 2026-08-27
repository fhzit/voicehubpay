<?php

declare(strict_types=1);

namespace VoiceHubPay\Support;

/**
 * Period boundary math for Dashboard (default timezone Asia/Shanghai).
 * All stored timestamps are UTC ISO-8601 strings; boundaries are converted
 * to UTC ISO for direct string comparison.
 */
final class TimeRange
{
    /** @return array{from:string,to:string,previous_from:string,previous_to:string,label:string} */
    public static function resolve(string $range, string $customFrom = '', string $customTo = '', string $tz = 'Asia/Shanghai'): array
    {
        $zone = new \DateTimeZone($tz);
        $now = new \DateTimeImmutable('now', $zone);

        switch ($range) {
            case 'week':
                $start = $now->modify('monday this week')->setTime(0, 0, 0);
                $prevStart = $start->modify('-7 days');
                $prevEnd = $start;
                $label = '本周';
                break;
            case 'month':
                $start = $now->modify('first day of this month')->setTime(0, 0, 0);
                $prevEnd = $start;
                $prevStart = $start->modify('-1 month');
                $label = '本月';
                break;
            case 'custom':
                try {
                    $start = new \DateTimeImmutable($customFrom !== '' ? $customFrom : $now->format('Y-m-d') . ' 00:00:00', $zone);
                } catch (\Throwable) {
                    $start = $now->setTime(0, 0, 0);
                }
                try {
                    $end = new \DateTimeImmutable($customTo !== '' ? $customTo : $now->format('Y-m-d 23:59:59'), $zone);
                } catch (\Throwable) {
                    $end = $now;
                }
                $span = (int) $start->diff($end)->format('%a');
                $prevStart = $start->modify('-' . $span . ' days');
                $prevEnd = $start;
                $label = '自定义';
                break;
            case 'today':
            default:
                $start = $now->setTime(0, 0, 0);
                $prevStart = $start->modify('-1 day');
                $prevEnd = $start;
                $label = '今日';
                break;
        }

        $end = $now; // current period ends "now"

        return [
            'from' => self::toUtcIso($start),
            'to' => self::toUtcIso($end),
            'previous_from' => self::toUtcIso($prevStart),
            'previous_to' => self::toUtcIso($prevEnd),
            'label' => $label,
        ];
    }

    /**
     * Bucket boundaries for trend charts: hourly (today) or daily (week/month).
     *
     * @return array<int, array{label:string,from:string,to:string}>
     */
    public static function buckets(string $range, string $customFrom = '', string $customTo = '', string $tz = 'Asia/Shanghai'): array
    {
        $zone = new \DateTimeZone($tz);
        $now = new \DateTimeImmutable('now', $zone);
        $buckets = [];
        if ($range === 'today') {
            for ($h = 0; $h < 24; $h++) {
                $start = $now->setTime($h, 0, 0);
                $end = $start->modify('+1 hour');
                if ($start > $now) {
                    break;
                }
                $buckets[] = ['label' => sprintf('%02d:00', $h), 'from' => self::toUtcIso($start), 'to' => self::toUtcIso($end)];
            }
            return $buckets;
        }

        if ($range === 'custom') {
            try {
                $start = new \DateTimeImmutable($customFrom !== '' ? $customFrom : $now->format('Y-m-d') . ' 00:00:00', $zone);
            } catch (\Throwable) {
                $start = $now->setTime(0, 0, 0);
            }
            try {
                $end = new \DateTimeImmutable($customTo !== '' ? $customTo : $now->format('Y-m-d 23:59:59'), $zone);
            } catch (\Throwable) {
                $end = $now;
            }
        } else {
            $start = $now->modify('monday this week')->setTime(0, 0, 0);
            if ($range === 'month') {
                $start = $now->modify('first day of this month')->setTime(0, 0, 0);
            }
            $end = $now;
        }

        $cursor = $start->setTime(0, 0, 0);
        $limit = 0;
        while ($cursor <= $end && $limit < 400) {
            $next = $cursor->modify('+1 day');
            $buckets[] = ['label' => $cursor->format('m-d'), 'from' => self::toUtcIso($cursor), 'to' => self::toUtcIso($next)];
            $cursor = $next;
            $limit++;
        }
        return $buckets;
    }

    private static function toUtcIso(\DateTimeImmutable $dt): string
    {
        return $dt->setTimezone(new \DateTimeZone('UTC'))->format('c');
    }
}
