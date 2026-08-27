<?php

declare(strict_types=1);

use VoiceHubPay\Shop\OrderNumberService;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    // order number format: VH + 8-digit date + 8 alnum letters
    $no = OrderNumberService::generate();
    $t->assertMatches('/^VH\d{8}[A-Za-z0-9]{8}$/', $no);

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
