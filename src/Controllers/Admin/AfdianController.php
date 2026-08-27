<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Integrations\AfdianOrderProcessor;

final class AfdianController extends Controller
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
        $status = $request->string('status');
        $voicehub = $request->string('voicehub');
        $q = $request->string('q');
        $page = max(1, $request->int('page', 1));
        $afdian = $this->app->make('afdianOrders');
        $result = $afdian->listAdmin($status, $voicehub, $q, $page, 20);
        return $this->render('admin/afdian/index', [
            'orders' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
            'status' => $status,
            'voicehub' => $voicehub,
            'q' => $q,
            'stats' => [
                'sum' => $afdian->sumPaid(),
                'today_sum' => $afdian->sumToday(),
                'today_orders' => $afdian->countToday(),
                'voicehub' => $afdian->stats(),
                'last_webhook' => $afdian->lastWebhookAt(),
                'last_poll' => $afdian->lastPollAt(),
            ],
        ], 'admin');
    }

    public function sync(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $afdian = $this->app->make('afdian');
        $processor = new AfdianOrderProcessor($this->app);
        try {
            $results = $processor->processPoll($afdian);
            $success = count(array_filter($results, static fn ($r) => $r['status'] === 'success'));
            $failed = count(array_filter($results, static fn ($r) => $r['status'] === 'failed'));
            $this->audit($this->adminUserId(), 'afdian.sync', 'afdian', 'poll', ['total' => count($results), 'success' => $success, 'failed' => $failed], $request);
            return $this->redirect('/admin/afdian')->withFlash(sprintf('手动同步完成：共 %d 条，成功 %d，失败 %d。', count($results), $success, $failed));
        } catch (\Throwable $e) {
            return $this->redirect('/admin/afdian')->withFlash('同步失败：' . $e->getMessage(), 'error');
        }
    }

    public function retry(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $outTradeNo = $request->string('out_trade_no');
        $force = $request->int('force', 0) === 1;
        $processor = new AfdianOrderProcessor($this->app);
        try {
            $result = $processor->retry($outTradeNo, $force);
            $this->audit($this->adminUserId(), 'afdian.retry', 'afdian', $outTradeNo, ['result' => $result['status']], $request);
            $msg = match ($result['status']) {
                'success' => '推送成功（VoiceHub code = ' . $outTradeNo . '）。',
                'already_success' => '该订单已成功，未重复推送。',
                'failed' => '推送失败：' . $result['message'],
                default => '处理结果：' . $result['status'],
            };
            return $this->redirect('/admin/afdian')->withFlash($msg, $result['status'] === 'failed' ? 'error' : 'success');
        } catch (\InvalidArgumentException $e) {
            return $this->redirect('/admin/afdian')->withFlash($e->getMessage(), 'error');
        } catch (\Throwable $e) {
            return $this->redirect('/admin/afdian')->withFlash('重试失败：' . $e->getMessage(), 'error');
        }
    }
}
