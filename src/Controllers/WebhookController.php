<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\Config\Config;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Services\AfdianService;
use VoiceHubPay\Services\OrderService;

final class WebhookController
{
    public function __construct(private readonly Config $config, private readonly AfdianService $afdian, private readonly OrderService $orders)
    {
    }

    public function afdian(Request $request): Response
    {
        if (!$this->afdian->verifyWebhook($request)) {
            return Response::json(['ec' => 401, 'em' => 'invalid signature'], 401);
        }
        $order = $this->afdian->normalizeWebhookOrder($request->json());
        if (!$order) {
            return Response::json(['ec' => 422, 'em' => 'order not found in payload'], 422);
        }
        $this->orders->upsertAndDispatch($order);
        return Response::json(['ec' => 200, 'em' => '']);
    }
}
