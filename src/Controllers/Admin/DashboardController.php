<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class DashboardController extends Controller
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
        $range = $request->string('range', 'today');
        if (!in_array($range, ['today', 'week', 'month', 'custom'], true)) {
            $range = 'today';
        }
        $channel = $request->string('channel', 'all');
        if (!in_array($channel, ['all', 'shop', 'afdian'], true)) {
            $channel = 'all';
        }
        $customFrom = $request->string('from');
        $customTo = $request->string('to');

        $dashboard = $this->app->make('dashboard');
        $kpis = $dashboard->kpis($range, $channel, $customFrom, $customTo);
        $trends = $dashboard->trends($range, $channel, $customFrom, $customTo);
        $ranking = $dashboard->productRanking($request->string('rank', 'revenue'), 8);
        $inventory = $dashboard->inventoryOverview();
        $vhSources = $dashboard->voicehubSourceBreakdown();
        $recentFailures = $this->app->make('deliveries')->recentFailures(8);
        $afdianOrders = $this->app->make('afdianOrders');

        return $this->render('admin/dashboard', [
            'range' => $range,
            'channel' => $channel,
            'custom_from' => $customFrom,
            'custom_to' => $customTo,
            'kpis' => $kpis,
            'trends' => $trends,
            'ranking' => $ranking,
            'inventory' => $inventory,
            'vh_sources' => $vhSources,
            'recent_failures' => $recentFailures,
            'afdian_stats' => [
                'today_revenue' => $afdianOrders->sumToday(),
                'today_orders' => $afdianOrders->countToday(),
                'last_webhook' => $afdianOrders->lastWebhookAt(),
                'last_poll' => $afdianOrders->lastPollAt(),
                'voicehub' => $afdianOrders->stats(),
            ],
        ], 'admin');
    }
}
