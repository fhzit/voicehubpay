<?php /** @var array $user @var array $connections @var array $orders @var int $consumption @var int $card_count @var ?int $super_id @var bool $is_super @var \VoiceHubPay\App $__app @var ?array $__user */
$__pageTitle = '用户 ' . $user['username'];
$isTargetSuper = (int) ($user['id']) === (int) ($super_id ?? 0);
$isAdminUser = ($user['role'] === 'admin' || $isTargetSuper);
$isSelf = (int) ($user['id']) === (int) ($__user['id'] ?? 0);
?>
<div class="filters">
  <a href="/admin/users" class="btn btn-ghost btn-sm">← 返回用户列表</a>
  <span style="font-weight:700;"><?= \VoiceHubPay\Http\View::e($user['username']) ?></span>
  <?php if ($isTargetSuper): ?><span class="badge badge-purple" title="初始创建的第一位管理员，不可被降级">超级管理员</span><?php elseif ($user['role'] === 'admin'): ?><span class="badge badge-purple">管理员</span><?php else: ?><span class="badge badge-gray">用户</span><?php endif; ?>
  <?= $__app->view->partial('partials/status-badge', ['kind' => 'user', 'status' => $user['status']]) ?>
  <div class="flex-1"></div>
  <?php if ($is_super && !$isTargetSuper): ?>
    <?php if ($isAdminUser): ?>
      <form method="post" action="/admin/users/<?= (int) $user['id'] ?>/role" data-confirm="确定将「<?= \VoiceHubPay\Http\View::e($user['username']) ?>」降级为普通用户？">
        <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
        <input type="hidden" name="role" value="user">
        <button class="btn btn-ghost btn-sm">降级为普通用户</button>
      </form>
    <?php else: ?>
      <form method="post" action="/admin/users/<?= (int) $user['id'] ?>/role" data-confirm="确定将「<?= \VoiceHubPay\Http\View::e($user['username']) ?>」设为管理员？">
        <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
        <input type="hidden" name="role" value="admin">
        <button class="btn btn-primary btn-sm">设为管理员</button>
      </form>
    <?php endif; ?>
  <?php endif; ?>
  <?php if (!$isSelf): ?>
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
    <div class="flex-between" style="margin-bottom:12px;">
      <h3 class="card-title mb-0">基本信息</h3>
      <button class="btn btn-ghost btn-sm" type="button" id="edit-profile-toggle">编辑</button>
    </div>
    <div id="profile-static">
      <div class="summary-row"><span class="muted">用户名</span><span><?= \VoiceHubPay\Http\View::e($user['username']) ?></span></div>
      <div class="summary-row"><span class="muted">昵称</span><span><?= \VoiceHubPay\Http\View::e($user['display_name'] ?: '—') ?></span></div>
    </div>
    <form id="profile-edit" method="post" action="/admin/users/<?= (int) $user['id'] ?>/update" style="display:none;">
      <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
      <div class="field">
        <label class="label">用户名</label>
        <input class="input" type="text" name="username" value="<?= \VoiceHubPay\Http\View::e($user['username']) ?>" required>
        <div class="hint">3-32 位：字母、数字、下划线、短横线、中文。</div>
      </div>
      <div class="field">
        <label class="label">昵称</label>
        <input class="input" type="text" name="display_name" value="<?= \VoiceHubPay\Http\View::e($user['display_name'] ?? '') ?>">
        <div class="hint">最长 50 字符。</div>
      </div>
      <div class="flex" style="gap:8px;">
        <button class="btn btn-primary btn-sm">保存</button>
        <button class="btn btn-ghost btn-sm" type="button" id="profile-edit-cancel">取消</button>
      </div>
    </form>
    <div class="summary-row" style="margin-top:14px;"><span class="muted">邮箱</span><span><?= \VoiceHubPay\Http\View::e($user['email'] ?: '—') ?></span></div>
    <div class="summary-row"><span class="muted">角色</span><span><?= $isTargetSuper ? '超级管理员（初始管理员，不可降级）' : ($user['role'] === 'admin' ? '管理员' : '普通用户') ?></span></div>
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

<script>
(function () {
  var toggle = document.getElementById('edit-profile-toggle');
  if (!toggle) return;
  var st = document.getElementById('profile-static');
  var edit = document.getElementById('profile-edit');
  var cancel = document.getElementById('profile-edit-cancel');
  function show() {
    st.style.display = 'none';
    edit.style.display = '';
    toggle.style.display = 'none';
    edit.querySelector('input[name=username]').focus();
  }
  toggle.addEventListener('click', show);
  if (cancel) cancel.addEventListener('click', function () {
    edit.style.display = 'none';
    st.style.display = '';
    toggle.style.display = '';
  });
  // 从列表“编辑”按钮带锚点进入时自动展开编辑表单
  if (window.location.hash === '#edit-profile-toggle') show();
})();
</script>