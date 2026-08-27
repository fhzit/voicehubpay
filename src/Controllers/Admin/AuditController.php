<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class AuditController extends Controller
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
        $filters = [
            'action' => $request->string('action'),
            'object_type' => $request->string('object_type'),
            'q' => $request->string('q'),
            'from' => $request->string('from'),
            'to' => $request->string('to'),
        ];
        $page = max(1, $request->int('page', 1));
        $audit = $this->app->make('audit');
        $result = $audit->list($filters, $page, 30);
        return $this->render('admin/audit', [
            'logs' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
            'filters' => $filters,
            'actions' => $audit->distinctActions(),
        ], 'admin');
    }
}
