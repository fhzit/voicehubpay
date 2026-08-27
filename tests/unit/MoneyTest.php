<?php

declare(strict_types=1);

use VoiceHubPay\Support\Money;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    // Decimal-string -> cents, never float.
    $t->assertSame(0, Money::toCents('0'));
    $t->assertSame(0, Money::toCents('0.00'));
    $t->assertSame(100, Money::toCents('1'));
    $t->assertSame(100, Money::toCents('1.00'));
    $t->assertSame(990, Money::toCents('9.9'));
    $t->assertSame(1250, Money::toCents('12.50'));
    $t->assertSame(1, Money::toCents('0.01'));
    $t->assertSame(50, Money::toCents('0.50'));
    $t->assertSame(5, Money::toCents('0.05'));
    $t->assertSame(-1250, Money::toCents('-12.50'));
    // thousands separators / whitespace tolerated
    $t->assertSame(123456789, Money::toCents('1,234,567.89'));
    $t->assertSame(123456789, Money::toCents('1234567.89'));
    // integer input treated as cents already
    $t->assertSame(990, Money::toCents(990));
    // large values, no float precision loss
    $t->assertSame(9999999999999, Money::toCents('99999999999.99'));

    // malformed input rejected
    $t->assertThrows(\InvalidArgumentException::class, static fn () => Money::toCents(''));
    $t->assertThrows(\InvalidArgumentException::class, static fn () => Money::toCents('abc'));
    $t->assertThrows(\InvalidArgumentException::class, static fn () => Money::toCents('1.234'));
    $t->assertThrows(\InvalidArgumentException::class, static fn () => Money::toCents('1.2.3'));
    $t->assertThrows(\InvalidArgumentException::class, static fn () => Money::toCents('1e3'));

    // format round-trip
    $t->assertSame('12.50', Money::format(1250));
    $t->assertSame('0.05', Money::format(5));
    $t->assertSame('99.99', Money::format(9999));
    $t->assertSame('-1.00', Money::format(-100));

    return ['assertions' => $t->assertions()];
};
