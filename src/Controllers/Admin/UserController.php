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
            'super_id' => $this->app->make('users')->superAdminId(),
            'is_super' => $this->auth->isSuperAdmin(),
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
            'super_id' => $this->app->make('users')->superAdminId(),
            'is_super' => $this->auth->isSuperAdmin(),
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

    public function destroy(Request $request, array $params): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $users = $this->app->make('users');
        $id = (int) ($params['id'] ?? 0);
        $target = $users->findById($id);
        if ($target === null) {
            return $this->redirect('/admin/users')->withFlash('用户不存在。', 'error');
        }
        if ((int) $id === (int) $this->adminUserId()) {
            return $this->redirect('/admin/users')->withFlash('不能删除当前登录的账号。', 'error');
        }
        if ($users->isSuperAdmin($id)) {
            return $this->redirect('/admin/users')->withFlash('超级管理员不可被删除。', 'error');
        }
        // Delete is intentionally only allowed after an account has been
        // disabled — an accidental deletion is less likely when the admin has
        // already deliberately disabled the account. Deletion is a physical
        // DELETE; the account disappears from the user list entirely.
        if (($target['status'] ?? '') !== 'disabled') {
            return $this->redirect('/admin/users')->withFlash('请先禁用该用户后再删除。', 'error');
        }
        $users->delete($id);
        $this->audit($this->adminUserId(), 'user.delete', 'user', (string) $id, ['username' => $target['username']], $request);
        return $this->redirect('/admin/users')->withFlash('用户「' . $target['username'] . '」已删除。');
    }

    public function setRole(Request $request, array $params): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $users = $this->app->make('users');
        $id = (int) ($params['id'] ?? 0);
        $target = $users->findById($id);
        if ($target === null) {
            return $this->redirect('/admin/users')->withFlash('用户不存在。', 'error');
        }
        $actorId = $this->adminUserId();
        $isSuper = $users->isSuperAdmin($actorId);
        $newRole = $request->string('role') === 'admin' ? 'admin' : 'user';
        $wasAdmin = in_array($target['role'] ?? 'user', ['admin', 'superadmin'], true);
        $isTargetSuper = $users->isSuperAdmin($id);
        // 1. Only the super admin may change another admin's role.
        // 2. The super admin itself can never be demoted (even by itself).
        if ($wasAdmin && !$isSuper) {
            return $this->redirect('/admin/users')->withFlash('只有超级管理员可以调整管理员的角色。', 'error');
        }
        if ($isTargetSuper) {
            return $this->redirect('/admin/users')->withFlash('超级管理员不可被降级。', 'error');
        }
        if ($wasAdmin && $newRole !== 'admin') {
            // demote an admin to a normal user
            $users->setRole($id, 'user');
            $this->audit($actorId, 'user.demote', 'user', (string) $id, ['username' => $target['username']], $request);
            return $this->redirect('/admin/users')->withFlash('已将「' . $target['username'] . '」降级为普通用户。');
        }
        if (!$wasAdmin && $newRole === 'admin') {
            // promote a normal user to admin
            $users->setRole($id, 'admin');
            $this->audit($actorId, 'user.promote', 'user', (string) $id, ['username' => $target['username']], $request);
            return $this->redirect('/admin/users')->withFlash('已将「' . $target['username'] . '」设为管理员。');
        }
        return $this->redirect('/admin/users')->withFlash('角色未变化。');
    }
}
