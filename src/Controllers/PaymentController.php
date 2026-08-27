<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Payments\PaymentService;

/**
 * SG65 V2 payment callbacks.
 */
final class PaymentController extends Controller
{
    /**
     * GET /payments/sg65/notify — SG65 sends notify as GET.
     * Returns plain text "success" ONLY after signature/amount verification.
     * VoiceHub failures never block this response.
     */
    public function notify(Request $request): Response
    {
        $query = $request->query;
        try {
            $payment = new PaymentService($this->app);
            $result = $payment->handleNotify($query);
        } catch (\Throwable $e) {
            error_log('[sg65 notify] ' . $e->getMessage());
            return Response::text('error', 500);
        }
        if ($result === 'success') {
            return Response::text('success');
        }
        // Log but return a non-committal response (never an exception page).
        error_log('[sg65 notify] rejected: ' . $result);
        return Response::text($result === 'verify_failed' ? 'verify_failed' : 'error', 200);
    }

    /**
     * GET /payments/sg65/return — NEVER confirms payment directly. Shows the
     * "confirming" page; the browser polls /api/orders/{orderNo}/status.
     */
    public function returnPage(Request $request): Response
    {
        $orderNo = (string) ($request->query['out_trade_no'] ?? '');
        $order = $orderNo !== '' ? $this->app->make('orders')->findByOrderNo($orderNo) : null;
        $user = $this->currentUser();
        // The gateway return URL is public, but order status/details are not.
        // Treat missing, guessed and another user's order number identically.
        if ($order === null || $user === null || (int) $order['user_id'] !== (int) $user['id']) {
            return $this->app->make('controllers.error')->notFound($request);
        }

        // If a logged-in user owns this order and local state is still unpaid,
        // attempt a server-side active query (best-effort, non-blocking).
        $alreadyPaid = $order !== null && $order['payment_status'] === 'paid';
        if (!$alreadyPaid && $order !== null) {
            try {
                $payment = new PaymentService($this->app);
                $payment->queryAndBackfill($order);
            } catch (\Throwable $e) {
                error_log('[sg65 return query] ' . $e->getMessage());
            }
        }

        return $this->render('checkout/pay-return', [
            'order' => $order,
            'order_no' => $orderNo,
        ], 'shop');
    }
}
