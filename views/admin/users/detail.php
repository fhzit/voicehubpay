<?php /** @var array $user @var array $connections @var array $orders @var int $consumption @var int $card_count @var \VoiceHubPay\App $__app @var ?array $__user */
$__pageTitle = '用户 ' . $user['username'];
?>
<div class="filters">
  <a href="/admin/users" class="btn btn-ghost btn-sm">← 返回用户列表</a>
  <span style="font-weight:700;"><?= \VoiceHubPay\Http\View::e($user['username']) ?></span>
  <?= $user['role'] === 'admin' ? '<span class="badge badge-purple">管理员</span>' : '<span class="badge badge-gray">用户</span>' ?>
  <?= $__app->view->partial('partials/status-badge', ['kind' => 'user', 'status' => $user['status']]) ?>
  <div class="flex-1"></div>
  <?php if ((int) $user['id'] !== (int) ($__user['id'] ?? 0)): ?>
    <form method="post" action="/admin/users/<?= (int) $user['id'] ?>/status" data-confirm="确定<?= $user['status'] === 'active' ? '禁用' : '恢复' ?>该用户？">
      <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
      <button class="btn btn-<?= $user['status'] === 'active' ? 'danger' : 'ghost' ?> btn-sm"><?= $user['status'] === 'active' ? '禁用' : '恢复' ?></button>
    </form>
  <?php endif; ?>
</div>

<div class="stat-grid" style="margin-bottom:16px;grid-template-columns:repeat(4,1fr);">
  <div class="stat-card"><div class="stat-label">累计消费</div><div class="stat-value">¥<?= \VoiceHubPay\Http\View::money($consumption) ?></div></div>
  <div class="stat-card"><div class="stat-label">订单数</div><div class="stat-value"><?= count($orders) ?></div></div>
  <div class="stat-card"><div class="stat-label">已获卡密</div><div class="stat-value"><?= $card_count ?></div></div>
  <div class="stat-card"><div class="stat-label">绑定方式</div><div class="stat-value"><?= count($connections) ?></div></div>
</div>

<div class="grid" style="grid-template-columns:1fr 1fr;align-items:start;">
  <div class="card">
    <h3 class="card-title mb-3">基本信息</h3>
    <div class="summary-row"><span class="muted">用户名</span><span><?= \VoiceHubPay\Http\View::e($user['username']) ?></span></div>
    <div class="summary-row"><span class="muted">昵称</span><span><?= \VoiceHubPay\Http\View::e($user['display_name'] ?: '—') ?></span></div>
    <div class="summary-row"><span class="muted">邮箱</span><span><?= \VoiceHubPay\Http\View::e($user['email'] ?: '—') ?></span></div>
    <div class="summary-row"><span class="muted">角色</span><span><?= $user['role'] === 'admin' ? '管理员' : '普通用户' ?></span></div>
    <div class="summary-row"><span class="muted">注册时间</span><span class="small"><?= \VoiceHubPay\Http\View::datetime($user['created_at']) ?></span></div>
    <div class="summary-row"><span class="muted">最后登录</span><span class="small"><?= \VoiceHubPay\Http\View::datetime($user['last_login_at']) ?></span></div>
  </div>
  <div class="card">
    <h3 class="card-title mb-3">登录绑定</h3>
    <div class="summary-row"><span class="muted">账号密码</span><span><?= empty($user['password_hash']) ? '<span class="badge badge-gray">未设置</span>' : '<span class="badge badge-green">已设置</span>' ?></span></div>
    <?php foreach (['qq' => 'QQ', 'wx' => '微信'] as $provider => $label): ?>
      <?php $conn = null; foreach ($connections as $c) { if ($c['provider'] === $provider) { $conn = $c; break; } } ?>
      <div class="summary-row"><span class="muted"><?= $label ?> 登录</span><span><?= $conn !== null ? '<span class="badge badge-blue">已绑定' . \VoiceHubPay\Http\View::e($conn['nickname'] ? '（' . $conn['nickname'] . '）' : '') . '</span>' : '<span class="badge badge-gray">未绑定</span>' ?></span></div>
    <?php endforeach; ?>
  </div>
</div>

<div class="section-head"><h2>订单记录</h2></div>
<div class="card card-pad-0">
  <div class="table-wrap"><table class="table">
    <thead><tr><th>订单号</th><th>商品</th><th class="num">金额</th><th>支付</th><th>发货</th><th>时间</th><th></th></tr></thead>
    <tbody>
    <?php if ($orders === []): ?><tr><td colspan="7" class="text-center muted">该用户暂无订单</td></tr><?php endif; ?>
    <?php foreach ($orders as $o): ?>
      <tr>
        <td class="mono"><?= \VoiceHubPay\Http\View::e($o['order_no']) ?></td>
        <td class="small"><?= \VoiceHubPay\Http\View::e($o['first_item_name'] ?? '') ?></td>
        <td class="num">¥<?= \VoiceHubPay\Http\View::money((int) $o['amount_due_cents']) ?></td>
        <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'payment', 'status' => $o['payment_status']]) ?></td>
        <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'fulfillment', 'status' => $o['fulfillment_status']]) ?></td>
        <td class="small muted"><?= \VoiceHubPay\Http\View::datetime($o['created_at']) ?></td>
        <td><a href="/admin/orders/<?= \VoiceHubPay\Http\View::e($o['order_no']) ?>" class="btn-link">处理</a></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table></div>
</div>
