<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class UserController extends Controller
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
        $q = $request->string('q');
        $status = $request->string('status');
        $page = max(1, $request->int('page', 1));
        $result = $this->app->make('users')->search($q, $status, $page, 20);
        $ordersRepo = $this->app->make('orders');
        foreach ($result['items'] as &$user) {
            $user['order_count'] = $ordersRepo->listForUser((int) $user['id'], '', '', 1, 1)['total'];
            $user['social'] = $this->app->make('social')->listForUser((int) $user['id']);
        }
        return $this->render('admin/users/index', [
            'users' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
            'q' => $q,
            'status' => $status,
        ], 'admin');
    }

    public function show(Request $request, array $params): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $user = $this->app->make('users')->findById((int) ($params['id'] ?? 0));
        if ($user === null) {
            return $this->redirect('/admin/users')->withFlash('用户不存在。', 'error');
        }
        $ordersRepo = $this->app->make('orders');
        $social = $this->app->make('social');
        $recentOrders = $ordersRepo->listForUserLatest((int) $user['id'], 20);
        $consumption = 0;
        foreach ($recentOrders as $o) {
            $consumption += (int) $o['amount_paid_cents'];
        }
        $unitRepo = $this->app->make('units');
        return $this->render('admin/users/detail', [
            'user' => $user,
            'connections' => $social->listForUser((int) $user['id']),
            'orders' => $recentOrders,
            'consumption' => $consumption,
            'card_count' => $unitRepo->countDeliveredForUser((int) $user['id']),
        ], 'admin');
    }

    public function toggleStatus(Request $request, array $params): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $id = (int) ($params['id'] ?? 0);
        $user = $this->app->make('users')->findById($id);
        if ($user === null) {
            return $this->redirect('/admin/users')->withFlash('用户不存在。', 'error');
        }
        $newStatus = $user['status'] === 'disabled' ? 'active' : 'disabled';
        $this->app->make('users')->setStatus($id, $newStatus);
        $this->audit($this->adminUserId(), 'user.status', 'user', (string) $id, ['to' => $newStatus, 'username' => $user['username']], $request);
        return $this->redirect('/admin/users')->withFlash('用户状态已更新。');
    }
}
