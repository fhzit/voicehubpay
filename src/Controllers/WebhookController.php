<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\App;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Integrations\AfdianOrderProcessor;

/**
 * Afdian webhook — routes straight into the single AfdianOrderProcessor.
 */
final class WebhookController extends Controller
{
    public function __construct(App $app)
    {
        parent::__construct($app);
    }

    public function afdian(Request $request): Response
    {
        $afdian = $this->app->make('afdian');
        if (!$afdian->isEnabled()) {
            return Response::json(['ec' => 503, 'em' => 'disabled'], 503);
        }
        $processor = $this->app->make('afdianProcessor');
        try {
            $result = $processor->processWebhook($afdian, $request);
            return Response::json(['ec' => 200, 'em' => '', 'status' => $result['status']]);
        } catch (\InvalidArgumentException $e) {
            $message = $e->getMessage();
            if ($message === 'invalid signature') {
                return Response::json(['ec' => 401, 'em' => 'invalid signature'], 401);
            }
            return Response::json(['ec' => 422, 'em' => $message], 422);
        } catch (\Throwable $e) {
            error_log('[afdian webhook] ' . $e->getMessage());
            return Response::json(['ec' => 500, 'em' => 'internal error'], 500);
        }
    }
}
