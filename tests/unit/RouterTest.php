<?php

declare(strict_types=1);

use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Http\Router;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    $router = new Router();
    $calls = [];

    $router->get('/products', function (Request $r) use (&$calls) {
        $calls[] = 'list';
        return Response::text('list');
    });
    $router->get('/products/{slug}', function (Request $r, array $p) use (&$calls) {
        $calls[] = 'detail:' . $p['slug'];
        return Response::text('detail:' . $p['slug']);
    });
    $router->post('/orders', function (Request $r) use (&$calls) {
        $calls[] = 'create';
        return Response::text('created');
    });
    $router->any('/payments/sg65/notify', function (Request $r) {
        return Response::text('notify');
    });

    $mk = static fn (string $method, string $path, array $query = []) => new Request($method, $path, $query, [], [], '127.0.0.1', 'cli', [], 'text/plain');

    $r1 = $router->dispatch($mk('GET', '/products'));
    $t->assertTrue($r1 instanceof Response);
    $t->assertSame('list', $r1->body());

    $r2 = $router->dispatch($mk('GET', '/products/abc-def'));
    $t->assertSame('detail:abc-def', $r2->body());
    $t->assertContains('detail:abc-def', $calls[1] ?? '', 'slug passed to handler');

    // method mismatch
    $t->assertNull($router->dispatch($mk('DELETE', '/products')));

    // any-method route
    $t->assertSame('notify', $router->dispatch($mk('GET', '/payments/sg65/notify'))->body());
    $t->assertSame('notify', $router->dispatch($mk('POST', '/payments/sg65/notify'))->body());

    // literal beats param even when the param route is registered FIRST
    $router->get('/y/{id}', fn (Request $r, array $p) => Response::text('param:' . $p['id']));
    $router->get('/y', fn () => Response::text('literal'));
    $t->assertSame('literal', $router->dispatch($mk('GET', '/y'))->body());

    // regression: /auth/social/callback must not be captured by {provider}
    // regardless of registration order
    $router->get('/auth/social/{provider}', fn (Request $r, array $p) => Response::text('social:' . $p['provider']));
    $router->get('/auth/social/callback', fn () => Response::text('social:callback'));
    $t->assertSame('social:callback', $router->dispatch($mk('GET', '/auth/social/callback'))->body(), '/auth/social/callback is not captured by {provider}');
    $t->assertSame('social:qq', $router->dispatch($mk('GET', '/auth/social/qq'))->body(), '/auth/social/qq routes to provider param');

    // no route
    $t->assertNull($router->dispatch($mk('GET', '/nope')));

    // request helpers
    $q = $mk('GET', '/a', ['b' => '1']);
    $t->assertSame('1', $q->string('b'));
    $t->assertSame('1', (string) $q->int('b', 0));

    return ['assertions' => $t->assertions()];
};
