<?php

declare(strict_types=1);

use VoiceHubPay\Shop\OrderNumberService;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    // order number format: 20-digit timestamp (with microseconds) + 4 random digits = 24 numeric chars
    $no = OrderNumberService::generate();
    $t->assertMatches('/^\d{24}$/', $no, 'order number is pure 24-digit numeric');
    // starts with the current UTC date (Ymd), ends with 4 digits
    $now = gmdate('YmdHis');
    $t->assertSame(0, strpos($no, substr($now, 0, 8)), 'order number begins with current date');
    $t->assertMatches('/^\d{20}\d{4}$/', $no, '20-digit timestamp (with microseconds) + 4 random digits');
    $t->assertSame(0, preg_match('/[^0-9]/', $no), 'no non-digit characters');

    // unit numbering: -001..-00N for order_no source
    $t->assertSame($no . '-001', OrderNumberService::unitNo($no, 1));
    $t->assertSame($no . '-005', OrderNumberService::unitNo($no, 5));

    // uniqueness sanity: 1000 generated numbers are distinct
    $set = [];
    for ($i = 0; $i < 1000; $i++) {
        $set[OrderNumberService::generate()] = true;
    }
    $t->assertSame(1000, count($set), 'order numbers unique');

    return ['assertions' => $t->assertions()];
};
