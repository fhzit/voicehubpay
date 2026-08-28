<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Fulfillment\FulfillmentService;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Payments\PaymentService;
use VoiceHubPay\Repositories\InventoryRepository;
use VoiceHubPay\Security\PasswordHasher;

final class OrderController extends Controller
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
            'order_no' => $request->string('order_no'),
            'username' => $request->string('username'),
            'product' => $request->string('product'),
            'payment_status' => $request->string('payment_status'),
            'fulfillment_status' => $request->string('fulfillment_status'),
            'abnormal' => $request->string('abnormal'),
            'from' => $request->string('from'),
            'to' => $request->string('to'),
        ];
        $page = max(1, $request->int('page', 1));
        $result = $this->app->make('orders')->listAdmin($filters, $page, 20);
        return $this->render('admin/orders/index', [
            'orders' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
            'filters' => $filters,
        ], 'admin');
    }

    public function show(Request $request, array $params): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $orderNo = (string) ($params['orderNo'] ?? '');
        $order = $this->app->make('orders')->orderWithItems($orderNo);
        if ($order === null) {
            return $this->redirect('/admin/orders')->withFlash('订单不存在。', 'error');
        }
        $user = $this->app->make('users')->findById((int) $order['user_id']);
        $payments = $this->app->make('payments')->listForOrder((int) $order['id']);
        $unitStats = $this->app->make('orders')->countUnitsByStatus((int) $order['id']);
        $crypto = $this->app->crypto;

        $units = [];
        foreach ($order['units'] as $unit) {
            $delivery = $this->app->make('deliveries')->findByUnitId((int) $unit['id']);
            $units[] = [
                'unit' => $unit,
                'delivery' => $delivery,
                'code_masked' => $unit['delivery_code_ciphertext'] !== null ? $crypto->mask($crypto->decrypt($unit['delivery_code_ciphertext'])) : '',
                'delivery_masked' => $delivery !== null ? $crypto->mask($crypto->decrypt($delivery['code_ciphertext'])) : '',
            ];
        }

        $recentAudit = $this->app->make('audit')->list(['object_type' => 'order', 'q' => $orderNo], 1, 20)['items'];

        return $this->render('admin/orders/detail', [
            'order' => $order,
            'user' => $user,
            'payments' => $payments,
            'unit_stats' => $unitStats,
            'units' => $units,
            'recent_audit' => $recentAudit,
            'inventory_available' => $this->availableForOrder($order),
        ], 'admin');
    }

    // ---------------------------------------------------------- manual ops

    public function queryPayment(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $order = $this->orderFromRequest($request);
        if ($order === null) {
            return $this->redirect('/admin/orders')->withFlash('订单不存在。', 'error');
        }
        try {
            $payment = new PaymentService($this->app);
            $result = $payment->queryAndBackfill($order);
            $this->audit($this->adminUserId(), 'order.query_sg65', 'order', (string) $order['order_no'], ['status' => $result['status']], $request);
            $msg = $result['paid'] ? 'SG65 已确认支付，订单已入账。' : 'SG65 返回状态：' . $result['status'] . '（0未支付 1已支付 2已退款 3冻结 4预授权）';
            return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash($msg, $result['paid'] ? 'success' : 'warning');
        } catch (\Throwable $e) {
            return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash('查询失败：' . $e->getMessage(), 'error');
        }
    }

    public function manualConfirm(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $order = $this->orderFromRequest($request);
        if ($order === null) {
            return $this->redirect('/admin/orders')->withFlash('订单不存在。', 'error');
        }
        if ($order['payment_status'] === 'paid') {
            return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash('订单已是已支付状态。', 'warning');
        }
        $reason = trim($request->string('reason'));
        $password = $request->string('admin_password');
        $admin = $this->auth->user();
        if ($reason === '') {
            return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash('请填写处理原因。', 'error');
        }
        if (!PasswordHasher::verify($password, $admin['password_hash'] ?? null)) {
            return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash('管理员密码验证失败，操作已取消。', 'error');
        }

        $payment = new PaymentService($this->app);
        $payment->confirmPaid($order, 'manual', 'manual');
        $this->audit($this->adminUserId(), 'order.manual_confirm', 'order', (string) $order['order_no'], [
            'amount_cents' => (int) $order['amount_due_cents'],
            'reason' => $reason,
            'source' => 'manual',
        ], $request);
        return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash('已人工确认入账。');
    }

    public function cancelOrder(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $order = $this->orderFromRequest($request);
        if ($order === null) {
            return $this->redirect('/admin/orders')->withFlash('订单不存在。', 'error');
        }
        $reason = trim($request->string('reason'));
        if ($reason === '') {
            return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash('请填写处理原因。', 'error');
        }
        try {
            $shop = new \VoiceHubPay\Shop\ShopService($this->app);
            $shop->cancelUnpaidOrder((int) $order['id'], $reason);
            $this->audit($this->adminUserId(), 'order.cancel', 'order', (string) $order['order_no'], ['reason' => $reason], $request);
            return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash('订单已取消，库存已释放。');
        } catch (\InvalidArgumentException $e) {
            return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash($e->getMessage(), 'error');
        }
    }

    public function processOrder(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $order = $this->orderFromRequest($request);
        if ($order === null) {
            return $this->redirect('/admin/orders')->withFlash('订单不存在。', 'error');
        }
        $fulfillment = new FulfillmentService($this->app);
        $result = $fulfillment->processOrder((int) $order['id']);
        $this->audit($this->adminUserId(), 'order.process', 'order', (string) $order['order_no'], $result, $request);
        return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash(sprintf('处理完成：成功 %d，失败 %d。', $result['success'], $result['failed']));
    }

    public function retryFailed(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $order = $this->orderFromRequest($request);
        if ($order === null) {
            return $this->redirect('/admin/orders')->withFlash('订单不存在。', 'error');
        }
        $fulfillment = new FulfillmentService($this->app);
        $result = $fulfillment->processOrder((int) $order['id']);
        $this->audit($this->adminUserId(), 'order.retry_failed', 'order', (string) $order['order_no'], $result, $request);
        return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash('已重试失败项。');
    }

    public function retryUnit(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $unitId = $request->int('unit_id', 0);
        $force = $request->int('force', 0) === 1;
        $reason = trim($request->string('reason'));
        $orderNo = $request->string('order_no');

        if ($force && $reason === '') {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('强制重推需要填写原因。', 'error');
        }
        $unit = $this->app->make('orders')->findUnit($unitId);
        if ($unit === null) {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('发放单元不存在。', 'error');
        }
        if (!$force && $unit['voicehub_status'] === 'success') {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('该单元已成功，普通重试已禁用。如需重发请使用“强制重新推送”。', 'warning');
        }
        try {
            $fulfillment = new FulfillmentService($this->app);
            $delivery = $fulfillment->retryUnit($unitId, $force);
            $this->audit($this->adminUserId(), $force ? 'unit.force_retry' : 'unit.retry', 'unit', (string) $unitId, [
                'order_no' => $orderNo,
                'reason' => $force ? $reason : '',
                'result' => $delivery['status'] ?? '',
            ], $request);
            $msg = ($delivery['status'] ?? '') === 'success' ? '推送成功。' : '推送已执行，请查看最新状态。';
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash($msg, ($delivery['status'] ?? '') === 'success' ? 'success' : 'warning');
        } catch (\Throwable $e) {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('重试失败：' . $e->getMessage(), 'error');
        }
    }

    public function manualCompleteUnit(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $unitId = $request->int('unit_id', 0);
        $reason = trim($request->string('reason'));
        $orderNo = $request->string('order_no');
        if ($reason === '') {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('请填写处理原因。', 'error');
        }
        try {
            $fulfillment = new FulfillmentService($this->app);
            $fulfillment->manualCompleteUnit($unitId, $reason);
            $this->audit($this->adminUserId(), 'unit.manual_complete', 'unit', (string) $unitId, ['order_no' => $orderNo, 'reason' => $reason], $request);
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('该单元已标记为人工完成。');
        } catch (\InvalidArgumentException $e) {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash($e->getMessage(), 'error');
        }
    }

    public function manualCompleteOrder(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $order = $this->orderFromRequest($request);
        if ($order === null) {
            return $this->redirect('/admin/orders')->withFlash('订单不存在。', 'error');
        }
        $reason = trim($request->string('reason'));
        if ($reason === '') {
            return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash('请填写处理原因。', 'error');
        }
        $fulfillment = new FulfillmentService($this->app);
        foreach ($order['units'] as $unit) {
            if (!in_array($unit['status'], ['success', 'manual_completed'], true)) {
                $fulfillment->manualCompleteUnit((int) $unit['id'], 'order manual complete: ' . $reason);
            }
        }
        $this->audit($this->adminUserId(), 'order.manual_complete', 'order', (string) $order['order_no'], ['reason' => $reason], $request);
        return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash('订单已整体标记为人工完成。');
    }

    public function assignCode(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $unitId = $request->int('unit_id', 0);
        $code = $request->string('code');
        $reason = trim($request->string('reason'));
        $orderNo = $request->string('order_no');
        if (trim($code) === '') {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('请输入卡密。', 'error');
        }
        if ($reason === '') {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('请填写处理原因。', 'error');
        }
        try {
            $fulfillment = new FulfillmentService($this->app);
            $fulfillment->assignManualCode($unitId, $code);
            $this->audit($this->adminUserId(), 'unit.assign_code', 'unit', (string) $unitId, ['order_no' => $orderNo, 'reason' => $reason], $request);
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('卡密已分配并加密保存。');
        } catch (\Throwable $e) {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('分配失败：' . $e->getMessage(), 'error');
        }
    }

    public function assignInventory(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $order = $this->orderFromRequest($request);
        if ($order === null) {
            return $this->redirect('/admin/orders')->withFlash('订单不存在。', 'error');
        }
        $orderNo = (string) $order['order_no'];
        // Only one product item per order in this system.
        $item = $order['items'][0] ?? null;
        if ($item === null) {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('订单无商品项。', 'error');
        }
        $productId = (int) $item['product_id'];
        $needed = 0;
        foreach ($order['units'] as $unit) {
            if ($unit['inventory_card_id'] === null && in_array($unit['status'], ['failed', 'pending'], true) && $unit['delivery_code_ciphertext'] === null) {
                $needed++;
            }
        }
        if ($needed === 0) {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('没有需要分配库存的单元。', 'warning');
        }
        $available = $this->app->make('inventory')->countAvailable($productId);
        if ($available < $needed) {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash(sprintf('可售库存不足：需要 %d，可售 %d。', $needed, $available), 'error');
        }
        $reason = trim($request->string('reason'));
        if ($reason === '') {
            return $this->redirect('/admin/orders/' . $orderNo)->withFlash('请填写处理原因。', 'error');
        }

        // Reserve new cards into this paid order and attach to the missing units.
        $cards = $this->app->make('inventory')->reserve($productId, $needed, (int) $order['id'], gmdate('c'), true);
        $fulfillment = new FulfillmentService($this->app);
        $idx = 0;
        foreach ($order['units'] as $unit) {
            if ($unit['inventory_card_id'] === null && in_array($unit['status'], ['failed', 'pending'], true) && $unit['delivery_code_ciphertext'] === null) {
                $card = $cards[$idx++];
                $this->app->make('orders')->updateUnit((int) $unit['id'], [
                    'inventory_card_id' => (int) $card['id'],
                    'delivery_code_ciphertext' => $card['secret_ciphertext'],
                    'delivery_code_hash' => $card['secret_hash'],
                    'status' => 'pending',
                    'voicehub_status' => $item['delivery_mode_snapshot'] === 'card_and_voicehub' ? 'pending' : 'not_required',
                    'voicehub_code_ciphertext' => $item['delivery_mode_snapshot'] === 'card_and_voicehub' ? $card['secret_ciphertext'] : null,
                    'voicehub_code_hash' => $item['delivery_mode_snapshot'] === 'card_and_voicehub' ? $card['secret_hash'] : null,
                    'manual_note' => 'admin_assigned_inventory',
                ]);
            }
        }
        $this->app->make('inventory')->markSoldForOrder((int) $order['id']);
        $this->audit($this->adminUserId(), 'order.assign_inventory', 'order', $orderNo, ['count' => $needed, 'reason' => $reason], $request);
        return $this->redirect('/admin/orders/' . $orderNo)->withFlash(sprintf('已分配 %d 张库存卡密并开始发货。', $needed));
    }

    public function deleteUnpaid(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $order = $this->orderFromRequest($request);
        if ($order === null) {
            return $this->redirect('/admin/orders')->withFlash('订单不存在。', 'error');
        }
        if ($order['payment_status'] === 'paid') {
            return $this->redirect('/admin/orders/' . $order['order_no'])->withFlash('已支付订单不能删除。', 'error');
        }
        // Release + soft-cancel (never hard delete money-related rows).
        $this->app->make('inventory')->releaseForOrder((int) $order['id']);
        $this->app->make('orders')->update((int) $order['id'], ['order_status' => 'cancelled', 'cancelled_at' => gmdate('c')]);
        // Mark this order's (unpaid/pending) payment transactions as cancelled so
        // the payment ledger does not keep showing them as "待确认".
        $this->app->make('payments')->markCancelledForOrder((int) $order['id']);
        $this->audit($this->adminUserId(), 'order.cancel', 'order', (string) $order['order_no'], ['reason' => $request->string('reason') ?: 'admin_cancel'], $request);
        return $this->redirect('/admin/orders')->withFlash('订单已取消并释放库存。');
    }

    // -------------------------------------------------------------- helpers

    private function orderFromRequest(Request $request): ?array
    {
        $orderNo = $request->string('order_no');
        if ($orderNo === '') {
            return null;
        }
        return $this->app->make('orders')->findByOrderNo($orderNo);
    }

    private function availableForOrder(array $order): int
    {
        $item = $order['items'][0] ?? null;
        if ($item === null) {
            return 0;
        }
        return $this->app->make('inventory')->countAvailable((int) $item['product_id']);
    }
}
