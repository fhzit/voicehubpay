<?php /** @var array $recent_orders @var int $order_count @var int $card_count @var array $connections @var \VoiceHubPay\App $__app @var ?array $__user */
$GLOBALS['__nav'] = 'account';
?>
<div class="page-head">
  <h1 class="page-title" style="font-size:26px;">欢迎回来，<?= \VoiceHubPay\Http\View::e($__user['display_name'] ?: $__user['username']) ?></h1>
  <p class="page-sub">管理你的订单、卡券与登录方式</p>
</div>

<div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:28px;">
  <a href="/account/orders" class="stat-card card-hover" style="display:block;text-decoration:none;">
    <div class="stat-label">订单</div>
    <div class="stat-value"><?= (int) $order_count ?></div>
    <div class="stat-delta flat">查看全部订单</div>
  </a>
  <a href="/account/cards" class="stat-card card-hover" style="display:block;text-decoration:none;">
    <div class="stat-label">卡券</div>
    <div class="stat-value"><?= (int) $card_count ?></div>
    <div class="stat-delta flat">查看我的卡密</div>
  </a>
  <a href="/account/connections" class="stat-card card-hover" style="display:block;text-decoration:none;">
    <div class="stat-label">账号绑定</div>
    <div class="stat-value"><?= count($connections) ?><small>/3</small></div>
    <div class="stat-delta flat">管理登录方式</div>
  </a>
</div>

<div class="section-head" style="margin-top:8px;"><h2>最近订单</h2><a href="/account/orders" class="btn btn-ghost btn-sm">全部订单</a></div>

<?php if ($recent_orders === []): ?>
  <div class="card empty">
    <div class="empty-ico">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
    </div>
    <div class="empty-title">还没有订单</div>
    <div><a href="/products" style="font-weight:600;">去逛逛商品</a></div>
  </div>
<?php else: ?>
  <div class="card card-pad-0">
    <div class="table-wrap"><table class="table">
      <thead><tr><th>订单号</th><th>商品</th><th class="num">金额</th><th>支付</th><th>发货</th><th>时间</th><th></th></tr></thead>
      <tbody>
      <?php foreach ($recent_orders as $o): ?>
        <tr>
          <td class="mono"><?= \VoiceHubPay\Http\View::e($o['order_no']) ?></td>
          <td><?= \VoiceHubPay\Http\View::e($o['first_item_name'] ?? '') ?><?= ((int) ($o['item_count'] ?? 1)) > 1 ? ' <span class="small muted">×' . (int) $o['item_count'] . '</span>' : '' ?></td>
          <td class="num">¥<?= \VoiceHubPay\Http\View::money((int) $o['amount_paid_cents']) ?></td>
          <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'payment', 'status' => $o['payment_status']]) ?></td>
          <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'fulfillment', 'status' => $o['fulfillment_status']]) ?></td>
          <td class="small muted"><?= \VoiceHubPay\Http\View::datetime($o['created_at']) ?></td>
          <td class="text-right"><a href="/orders/<?= \VoiceHubPay\Http\View::e($o['order_no']) ?>" class="btn-link">详情</a></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table></div>
  </div>
<?php endif; ?>
