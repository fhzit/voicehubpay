<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\App;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class ErrorController extends Controller
{
    public function notFound(Request $request): Response
    {
        return $this->render('errors/404', [], 'shop');
    }

    public function forbidden(Request $request): Response
    {
        return $this->render('errors/403', [], 'shop');
    }

    public function serverError(Request $request, string $requestId = ''): Response
    {
        return $this->render('errors/500', ['request_id' => $requestId], 'shop');
    }

    public function maintenance(Request $request): Response
    {
        return $this->render('errors/maintenance', [], 'shop');
    }
}
