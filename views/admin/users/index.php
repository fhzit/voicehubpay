<?php /** @var array $users @var int $total @var int $page @var int $pages @var string $q @var string $status @var \VoiceHubPay\App $__app */
$__pageTitle = '用户管理';
?>
<div class="filters">
  <form method="get" action="/admin/users" class="flex" style="gap:10px;flex-wrap:wrap;flex:1;">
    <input type="text" name="q" class="input search" placeholder="用户名/昵称/邮箱" value="<?= \VoiceHubPay\Http\View::e($q) ?>">
    <select name="status" class="select">
      <option value="">全部状态</option>
      <option value="active" <?= $status === 'active' ? 'selected' : '' ?>>正常</option>
      <option value="disabled" <?= $status === 'disabled' ? 'selected' : '' ?>>已禁用</option>
    </select>
    <button class="btn btn-secondary">筛选</button>
  </form>
</div>

<div class="card card-pad-0">
  <div class="table-wrap"><table class="table">
    <thead><tr><th>用户</th><th>角色</th><th>订单数</th><th>绑定</th><th>状态</th><th>注册时间</th><th class="text-right">操作</th></tr></thead>
    <tbody>
    <?php if ($users === []): ?>
      <tr><td colspan="7" class="text-center muted">暂无用户</td></tr>
    <?php endif; ?>
    <?php foreach ($users as $u): ?>
      <tr>
        <td>
          <div class="flex" style="gap:8px;">
            <span class="avatar avatar-sm"><?= \VoiceHubPay\Http\View::e(mb_substr($u['display_name'] ?: $u['username'], 0, 1)) ?></span>
            <div>
              <div style="font-weight:600;"><?= \VoiceHubPay\Http\View::e($u['username']) ?></div>
              <div class="small muted"><?= \VoiceHubPay\Http\View::e($u['display_name'] ?: '—') ?><?= $u['email'] ? ' · ' . \VoiceHubPay\Http\View::e($u['email']) : '' ?></div>
            </div>
          </div>
        </td>
        <td><?= $u['role'] === 'admin' ? '<span class="badge badge-purple">管理员</span>' : '<span class="badge badge-gray">用户</span>' ?></td>
        <td><?= (int) $u['order_count'] ?></td>
        <td class="small"><?php foreach ($u['social'] as $s): ?><span class="badge badge-blue" style="margin-right:4px;"><?= $s['provider'] === 'qq' ? 'QQ' : '微信' ?></span><?php endforeach; ?><?= empty($u['password_hash']) ? '' : '<span class="badge badge-gray">密码</span>' ?></td>
        <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'user', 'status' => $u['status']]) ?></td>
        <td class="small muted"><?= \VoiceHubPay\Http\View::datetime($u['created_at']) ?></td>
        <td class="text-right">
          <div class="flex" style="justify-content:flex-end;gap:6px;">
            <a href="/admin/users/<?= (int) $u['id'] ?>" class="btn btn-secondary btn-sm">详情</a>
            <?php if ((int) $u['id'] !== (int) ($__user['id'] ?? 0)): ?>
              <form method="post" action="/admin/users/<?= (int) $u['id'] ?>/status" data-confirm="确定<?= $u['status'] === 'active' ? '禁用' : '恢复' ?>用户「<?= \VoiceHubPay\Http\View::e($u['username']) ?>」？" style="display:inline;">
                <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
                <button class="btn btn-<?= $u['status'] === 'active' ? 'danger' : 'ghost' ?> btn-sm"><?= $u['status'] === 'active' ? '禁用' : '恢复' ?></button>
              </form>
            <?php endif; ?>
          </div>
        </td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table></div>
</div>

<?php if ($pages > 1): ?>
  <div class="pagination">
    <?php for ($i = 1; $i <= $pages; $i++): ?>
      <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="/admin/users?q=<?= \VoiceHubPay\Http\View::e(urlencode($q)) ?>&status=<?= \VoiceHubPay\Http\View::e($status) ?>&page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
    <?php endfor; ?>
  </div>
<?php endif; ?>
