<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class PaymentController extends Controller
{
    public function __construct(App $app)
    {
        parent::__construct($app);
    }

    public function index(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $payType = $request->string('pay_type');
        $status = $request->string('status');
        $q = $request->string('q');
        $page = max(1, $request->int('page', 1));
        $result = $this->app->make('payments')->listAdmin($payType, $status, $q, $page, 20);
        return $this->render('admin/payments/index', [
            'transactions' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
            'pay_type' => $payType,
            'status' => $status,
            'q' => $q,
        ], 'admin');
    }
}
