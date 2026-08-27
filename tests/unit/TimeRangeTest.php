<?php

declare(strict_types=1);

use VoiceHubPay\Support\TimeRange;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    $tz = 'Asia/Shanghai';

    // week: Monday 00:00 local, expressed as UTC ISO-8601
    $r = TimeRange::resolve('week', '', '', $tz);
    $t->assertSame('本周', $r['label']);
    $t->assertTrue(str_ends_with($r['from'], '+00:00'), 'boundaries stored in UTC');
    $t->assertTrue($r['to'] > $r['from'], 'to after from');
    // from must be a Monday 00:00 in Shanghai
    $fromSh = (new DateTimeImmutable($r['from']))->setTimezone(new DateTimeZone($tz));
    $t->assertSame(1, (int) $fromSh->format('N'), 'week starts Monday');
    $t->assertSame('00:00:00', $fromSh->format('H:i:s'));

    // month: first day 00:00 local, previous month ends exactly at it
    $r = TimeRange::resolve('month', '', '', $tz);
    $t->assertSame('本月', $r['label']);
    $fromSh = (new DateTimeImmutable($r['from']))->setTimezone(new DateTimeZone($tz));
    $t->assertSame(1, (int) $fromSh->format('d'), 'month starts on the 1st (local)');
    $t->assertSame('00:00:00', $fromSh->format('H:i:s'), 'month starts at local midnight');
    $t->assertTrue($r['previous_to'] === $r['from'], 'previous month ends exactly at this month start');

    // custom range label + previous period (equal span directly before from)
    $r = TimeRange::resolve('custom', '2024-06-10 08:00:00', '2024-06-20 18:00:00', $tz);
    $t->assertSame('自定义', $r['label']);
    $t->assertTrue(str_contains($r['from'], '2024-06-10'), 'custom from honored');
    $prevFromSh = (new DateTimeImmutable($r['previous_from']))->setTimezone(new DateTimeZone($tz));
    $t->assertSame('2024-05-31', $prevFromSh->format('Y-m-d'), 'previous period equal span before from');

    // invalid custom input falls back to today 00:00
    $r = TimeRange::resolve('custom', 'not-a-date', '', $tz);
    $t->assertTrue($r['from'] !== '', 'fallback start populated');

    // today range
    $r = TimeRange::resolve('today', '', '', $tz);
    $t->assertSame('今日', $r['label']);
    $todaySh = (new DateTimeImmutable($r['from']))->setTimezone(new DateTimeZone($tz));
    $t->assertSame('00:00:00', $todaySh->format('H:i:s'), 'today starts at midnight local');

    // trend buckets (daily) for a week
    $buckets = TimeRange::buckets('week', '', '', $tz);
    $t->assertTrue(count($buckets) >= 1, 'at least one bucket');
    $t->assertMatches('/^\d{2}-\d{2}$/', $buckets[0]['label'], 'daily bucket label');

    return ['assertions' => $t->assertions()];
};
