<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Fulfillment\FulfillmentService;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class VoiceHubController extends Controller
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
            'status' => $request->string('status'),
            'code_source' => $request->string('code_source'),
            'q' => $request->string('q'),
        ];
        $page = max(1, $request->int('page', 1));
        $result = $this->app->make('deliveries')->list($filters, $page, 20);
        $crypto = $this->app->crypto;
        foreach ($result['items'] as &$row) {
            $row['code_masked'] = $crypto->mask($crypto->decrypt($row['code_ciphertext']));
        }
        return $this->render('admin/voicehub/index', [
            'deliveries' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
            'filters' => $filters,
            'stats' => $this->app->make('deliveries')->stats(),
        ], 'admin');
    }

    public function failures(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $page = max(1, $request->int('page', 1));
        $result = $this->app->make('deliveries')->list(['only_failed' => true, 'q' => $request->string('q')], $page, 20);
        $crypto = $this->app->crypto;
        foreach ($result['items'] as &$row) {
            $row['code_masked'] = $crypto->mask($crypto->decrypt($row['code_ciphertext']));
        }
        return $this->render('admin/voicehub/failures', [
            'deliveries' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
        ], 'admin');
    }

    public function retry(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $deliveryId = $request->int('delivery_id', 0);
        $delivery = $this->app->make('deliveries')->findById($deliveryId);
        if ($delivery === null) {
            return $this->redirect('/admin/voicehub')->withFlash('推送记录不存在。', 'error');
        }
        // Route by source type.
        $fulfillment = new FulfillmentService($this->app);
        if ($delivery['source_type'] === 'afdian') {
            $processor = $this->app->make('afdianProcessor');
            $processor->retry((string) $delivery['source_order_no']);
            $this->audit($this->adminUserId(), 'voicehub.retry', 'delivery', (string) $deliveryId, ['source' => 'afdian'], $request);
            return $this->redirect('/admin/voicehub')->withFlash('已重试该爱发电推送。');
        }
        if ($delivery['fulfillment_unit_id'] !== null) {
            $fulfillment->retryUnit((int) $delivery['fulfillment_unit_id']);
            $this->audit($this->adminUserId(), 'voicehub.retry', 'delivery', (string) $deliveryId, ['source' => 'shop'], $request);
            return $this->redirect('/admin/voicehub')->withFlash('已重试该商城推送。');
        }
        return $this->redirect('/admin/voicehub')->withFlash('无法重试该记录。', 'error');
    }

    public function retryAllFailed(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        // Still processes one HTTP request per code — never batches.
        $fulfillment = new FulfillmentService($this->app);
        $summary = $fulfillment->processPendingOrders(100);
        $this->audit($this->adminUserId(), 'voicehub.retry_all', 'voicehub', 'all', $summary, $request);
        return $this->redirect('/admin/voicehub/failures')->withFlash(sprintf('批量重试完成：处理 %d 个单元，成功 %d，失败 %d。', $summary['processed'], $summary['success'], $summary['failed']));
    }
}
