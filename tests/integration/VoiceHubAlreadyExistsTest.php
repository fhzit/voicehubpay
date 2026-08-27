<?php

declare(strict_types=1);

use VoiceHubPay\Integrations\VoiceHubApiClient;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app] = $t->freshApp('vh-already');
    $client = new VoiceHubApiClient($app);

    $m = new \ReflectionMethod(VoiceHubApiClient::class, 'isAlreadyExists');
    $m->setAccessible(true);

    // The exact payload seen in production when VoiceHub reports the code was
    // already created: treat as already-delivered (not an error), so the order
    // shows 已发货 instead of a failure banner.
    $prod = json_decode(
        '{"error":true,"url":"https://music.idoknow.top/api/open/card-codes","statusCode":400,"statusMessage":"Server Error","message":"这些点歌券已经存在，无需重复创建"}',
        true
    );
    $t->assertTrue((bool) $m->invoke($client, $prod), 'production already-exists payload is detected');

    $t->assertTrue((bool) $m->invoke($client, ['message' => '这些点歌券已经存在，无需重复创建']), 'already-exists message detected');
    $t->assertTrue((bool) $m->invoke($client, ['message' => 'ticket already exists']), 'english already-exists detected');
    $t->assertFalse((bool) $m->invoke($client, ['message' => '库存不足，无可用卡密']), 'unrelated failure is NOT treated as already-exists');
    $t->assertFalse((bool) $m->invoke($client, []), 'empty payload is NOT already-exists');

    // Source guard: createTicket must return (not throw) on already-exists so
    // both the afdian and shop delivery paths mark the order as successful.
    $src = file_get_contents($t->basePath . '/src/Integrations/VoiceHubApiClient.php') ?: '';
    $t->assertContains('$this->isAlreadyExists($parsed)', $src, "already-exists branch short-circuits the throw");
    $t->assertContains('点歌券已经存在', $src, 'already-exists matcher accepts the production message');
    $t->assertContains('无需重复创建', $src, 'already-exists matcher accepts the production message variant');

    return ['assertions' => $t->assertions()];
};