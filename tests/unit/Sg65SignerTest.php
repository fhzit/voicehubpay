<?php

declare(strict_types=1);

use VoiceHubPay\Payments\Sg65Signer;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    // --- buildString: excludes sign/sign_type/empty/arrays, ASCII-sorted ---
    $params = [
        'sign' => 'ignored',
        'sign_type' => 'RSA2',
        'merchant_id' => 'M100',
        'amount' => '100',
        'empty' => '',
        'null_val' => null,
        'arr' => ['a', 'b'],
        'a_param' => '1',
        'B_upper' => '2',
    ];
    // ASCII: uppercase before lowercase => "B_upper" < "a_param" < "amount" < "merchant_id"
    $s = Sg65Signer::buildString($params);
    $t->assertSame('B_upper=2&a_param=1&amount=100&merchant_id=M100', $s);

    // --- round-trip sign/verify with generated keys ---
    $res = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    openssl_pkey_export($res, $private);
    $pub = openssl_pkey_get_details($res)['key'];

    $signed = Sg65Signer::sign(['merchant_id' => 'M1', 'order_id' => 'O9'], $private);
    $t->assertTrue($signed !== '', 'signature produced');
    $t->assertTrue(Sg65Signer::verify(['merchant_id' => 'M1', 'order_id' => 'O9', 'sign' => $signed, 'sign_type' => 'RSA2'], $pub));

    // tampering any field breaks verification
    $t->assertFalse(Sg65Signer::verify(['merchant_id' => 'M2', 'order_id' => 'O9', 'sign' => $signed], $pub));
    $t->assertFalse(Sg65Signer::verify(['merchant_id' => 'M1', 'order_id' => 'O9', 'sign' => 'not-base64'], $pub));
    // missing sign => false
    $t->assertFalse(Sg65Signer::verify(['merchant_id' => 'M1'], $pub));
    // empty value must be excluded from canonical string (like real SG65)
    $t->assertTrue(Sg65Signer::verify(['merchant_id' => 'M1', 'order_id' => 'O9', 'note' => '', 'sign' => $signed], $pub), 'empty fields ignored');

    // invalid key => throws on sign, false on verify
    $t->assertThrows(\RuntimeException::class, static fn () => Sg65Signer::sign(['a' => '1'], 'not-a-key'));
    $t->assertFalse(Sg65Signer::verify(['a' => '1', 'sign' => 'x'], 'not-a-key'));

    // regression: SG65 exposes keys as BARE base64 (no PEM armor). A bare key
    // must be wrapped into PEM automatically, or openssl fails with
    // "unsupported" and sign/verify break. Strip the armor from the generated
    // keys to simulate the platform's format.
    $barePriv = preg_replace('/-----BEGIN [^-]+-----/', '', $private);
    $barePriv = preg_replace('/-----END [^-]+-----/', '', $barePriv);
    $barePriv = preg_replace('/\s+/', '', $barePriv);
    $barePub = preg_replace('/-----BEGIN [^-]+-----/', '', $pub);
    $barePub = preg_replace('/-----END [^-]+-----/', '', $barePub);
    $barePub = preg_replace('/\s+/', '', $barePub);

    $signedBare = Sg65Signer::sign(['merchant_id' => 'M1', 'order_id' => 'O9'], $barePriv);
    $t->assertSame($signed, $signedBare, 'bare-base64 private key signs identically to PEM');
    $t->assertTrue(Sg65Signer::verify(['merchant_id' => 'M1', 'order_id' => 'O9', 'sign' => $signedBare], $barePub), 'bare-base64 public key verifies');

    return ['assertions' => $t->assertions()];
};
