<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

/**
 * JSON API for authenticated clients (polling + card reveal).
 */
final class ApiController extends Controller
{
    public function orderStatus(Request $request, array $params): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        $orderNo = (string) ($params['orderNo'] ?? '');
        $order = $this->app->make('orders')->orderWithItems($orderNo);
        $user = $this->currentUser();
        if ($order === null || !$this->owns($order, $user)) {
            return $this->json(['ok' => false, 'error' => 'not found'], 404);
        }
        $stats = $this->app->make('orders')->countUnitsByStatus((int) $order['id']);
        $total = (int) ($order['items'][0]['quantity'] ?? count($order['units']));
        return $this->json([
            'ok' => true,
            'payment_status' => $order['payment_status'],
            'order_status' => $order['order_status'],
            'fulfillment_status' => $order['fulfillment_status'],
            'paid_at' => $order['paid_at'],
            'unit_stats' => $stats,
            'unit_total' => $total,
        ]);
    }

    /**
     * Reveal a single unit's full code. Ownership is verified through
     * orders.user_id. Never returns other users' cards.
     */
    public function revealCard(Request $request, array $params): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $unitId = (int) ($params['unitId'] ?? 0);
        $unit = $this->app->make('orders')->findUnit($unitId);
        $user = $this->currentUser();
        if ($unit === null) {
            return $this->json(['ok' => false, 'error' => 'not found'], 404);
        }
        $order = $this->app->make('orders')->findById((int) $unit['order_id']);
        if ($order === null || (int) $order['user_id'] !== (int) $user['id']) {
            return $this->json(['ok' => false, 'error' => 'forbidden'], 403);
        }
        if ($order['payment_status'] !== 'paid') {
            return $this->json(['ok' => false, 'error' => '订单未支付'], 403);
        }
        if ($unit['delivery_code_ciphertext'] === null) {
            return $this->json(['ok' => false, 'error' => '尚未发放'], 202);
        }
        return $this->json([
            'ok' => true,
            'code' => $this->app->crypto->decrypt($unit['delivery_code_ciphertext']),
            'status' => $unit['status'],
            'voicehub_status' => $unit['voicehub_status'],
        ]);
    }

    /**
     * Reveal all codes of a paid order (copy-all).
     */
    public function revealOrder(Request $request, array $params): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $orderNo = (string) ($params['orderNo'] ?? '');
        $order = $this->app->make('orders')->orderWithItems($orderNo);
        $user = $this->currentUser();
        if ($order === null || !$this->owns($order, $user)) {
            return $this->json(['ok' => false, 'error' => 'forbidden'], 403);
        }
        if ($order['payment_status'] !== 'paid') {
            return $this->json(['ok' => false, 'error' => '订单未支付'], 403);
        }
        $codes = [];
        foreach ($order['units'] as $unit) {
            if ($unit['delivery_code_ciphertext'] !== null) {
                $codes[] = $this->app->crypto->decrypt($unit['delivery_code_ciphertext']);
            }
        }
        return $this->json(['ok' => true, 'codes' => $codes]);
    }

    private function owns(array $order, ?array $user): bool
    {
        return $user !== null && (int) $order['user_id'] === (int) $user['id'];
    }
}
