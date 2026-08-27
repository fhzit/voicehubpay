<?php /** @var array $orders @var int $total @var int $page @var int $pages @var string $status @var string $q @var \VoiceHubPay\App $__app */
$GLOBALS['__nav'] = 'orders';
$tabs = ['', 'unpaid', 'paid', 'completed', 'abnormal'];
$tabLabels = ['全部', '待支付', '待发货', '已完成', '异常'];
?>
<div class="container" style="padding-top:24px;">
  <div class="page-head flex-between flex-wrap">
    <div><h1 class="page-title">我的服务</h1><p class="page-sub">共 <?= $total ?> 项服务</p></div>
    <a href="/products" class="btn btn-primary btn-sm">更多服务</a>
  </div>

  <div class="tab-bar">
    <?php foreach ($tabs as $i => $t): ?>
      <a href="/account/orders?status=<?= $t ?>&q=<?= \VoiceHubPay\Http\View::e(urlencode($q)) ?>" class="tab <?= $status === $t ? 'active' : '' ?>"><?= $tabLabels[$i] ?></a>
    <?php endforeach; ?>
  </div>

  <form method="get" action="/account/orders" class="filters">
    <input type="hidden" name="status" value="<?= \VoiceHubPay\Http\View::e($status) ?>">
    <input type="text" name="q" class="input search" placeholder="搜索服务号…" value="<?= \VoiceHubPay\Http\View::e($q) ?>">
    <button class="btn btn-primary">搜索</button>
  </form>

  <?php if ($orders === []): ?>
    <div class="card empty">
      <div class="empty-ico">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
      </div>
      <div class="empty-title">暂无服务记录</div>
      <div>还没有符合条件的服务记录</div>
    </div>
  <?php else: ?>
    <div class="card card-pad-0">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>服务号</th><th>服务</th><th>金额</th><th>支付</th><th>发货</th><th>时间</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($orders as $o): ?>
          <tr>
            <td class="mono"><?= \VoiceHubPay\Http\View::e($o['order_no']) ?></td>
            <td><?= \VoiceHubPay\Http\View::e($o['first_item_name'] ?? '') ?><?= ((int) ($o['item_quantity'] ?? 1)) > 1 ? ' ×' . (int) $o['item_quantity'] : '' ?></td>
            <td class="num">¥<?= \VoiceHubPay\Http\View::money((int) ($o['amount_due_cents'] ?: $o['amount_paid_cents'])) ?></td>
            <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'payment', 'status' => $o['payment_status']]) ?></td>
            <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'fulfillment', 'status' => $o['fulfillment_status']]) ?></td>
            <td class="small muted"><?= \VoiceHubPay\Http\View::datetime($o['created_at']) ?></td>
            <td><a href="/orders/<?= \VoiceHubPay\Http\View::e($o['order_no']) ?>" class="btn-link">详情</a></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table></div>
    </div>
    <?php if ($pages > 1): ?>
      <div class="pagination">
        <?php for ($i = 1; $i <= $pages; $i++): ?>
          <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="/account/orders?status=<?= \VoiceHubPay\Http\View::e($status) ?>&q=<?= \VoiceHubPay\Http\View::e(urlencode($q)) ?>&page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
        <?php endfor; ?>
      </div>
    <?php endif; ?>
  <?php endif; ?>
</div>
