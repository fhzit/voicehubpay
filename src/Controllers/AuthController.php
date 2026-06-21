<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\Auth\OAuthClient;
use VoiceHubPay\Auth\SessionAuth;
use VoiceHubPay\Config\Config;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class AuthController
{
    private OAuthClient $oauth;

    public function __construct(private readonly Config $config)
    {
        $this->oauth = new OAuthClient($config);
    }

    public function login(Request $request): Response
    {
        $state = bin2hex(random_bytes(16));
        $_SESSION['oauth_state'] = $state;
        return Response::redirect($this->oauth->authorizationUrl($state));
    }

    public function callback(Request $request): Response
    {
        if (($request->query['state'] ?? '') !== ($_SESSION['oauth_state'] ?? null)) {
            return Response::text('Invalid OAuth state', 400);
        }
        if (empty($request->query['code'])) {
            return Response::text('Missing OAuth code', 400);
        }
        $token = $this->oauth->exchangeCode((string) $request->query['code']);
        $user = $this->oauth->userInfo((string) $token['access_token']);
        SessionAuth::login($user, $this->config);
        return Response::redirect('/');
    }

    public function logout(): Response
    {
        SessionAuth::logout();
        return Response::redirect('/');
    }
}
