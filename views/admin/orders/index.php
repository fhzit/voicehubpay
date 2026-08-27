<?php /** @var array $orders @var int $total @var int $page @var int $pages @var array $filters @var \VoiceHubPay\App $__app */
$__pageTitle = '订单管理';
$f = $filters;
$statusLabels = ['unpaid' => '未支付', 'pending' => '待支付', 'paid' => '已支付'];
?>
<div class="filters">
  <form method="get" action="/admin/orders" class="flex" style="gap:10px;flex-wrap:wrap;flex:1;">
    <input type="text" name="order_no" class="input" placeholder="订单号" value="<?= \VoiceHubPay\Http\View::e($f['order_no']) ?>" style="min-width:160px;">
    <input type="text" name="username" class="input" placeholder="用户" value="<?= \VoiceHubPay\Http\View::e($f['username']) ?>">
    <input type="text" name="product" class="input" placeholder="商品" value="<?= \VoiceHubPay\Http\View::e($f['product']) ?>">
    <select name="payment_status" class="select">
      <option value="">全部支付状态</option>
      <?php foreach (['paid' => '已支付', 'unpaid' => '未支付', 'pending' => '待确认', 'failed' => '支付失败'] as $pk => $pl): ?>
        <option value="<?= $pk ?>" <?= $f['payment_status'] === $pk ? 'selected' : '' ?>><?= $pl ?></option>
      <?php endforeach; ?>
    </select>
    <select name="fulfillment_status" class="select">
      <option value="">全部发货状态</option>
      <?php foreach (['success' => '已发货', 'manual_completed' => '人工完成', 'partial' => '部分完成', 'processing' => '发货中', 'pending' => '待发货', 'failed' => '发货失败', 'manual_review' => '待人工处理'] as $fk => $fl): ?>
        <option value="<?= $fk ?>" <?= $f['fulfillment_status'] === $fk ? 'selected' : '' ?>><?= $fl ?></option>
      <?php endforeach; ?>
    </select>
    <input type="date" name="from" class="input" value="<?= \VoiceHubPay\Http\View::e($f['from']) ?>">
    <input type="date" name="to" class="input" value="<?= \VoiceHubPay\Http\View::e($f['to']) ?>">
    <button class="btn btn-secondary">筛选</button>
    <?php if (!empty($f['abnormal'])): ?><a href="/admin/orders" class="btn btn-danger">× 异常过滤</a><?php endif; ?>
  </form>
  <a href="/admin/orders?abnormal=1" class="btn btn-<?= !empty($f['abnormal']) ? 'danger' : 'warning' ?>">异常订单</a>
</div>

<div class="card card-pad-0">
  <div class="table-wrap"><table class="table">
    <thead><tr><th>订单号</th><th>用户</th><th>商品</th><th class="num">应付</th><th>支付</th><th>发货</th><th>来源</th><th>时间</th><th></th></tr></thead>
    <tbody>
    <?php if ($orders === []): ?>
      <tr><td colspan="9" class="text-center muted">没有符合条件的订单</td></tr>
    <?php endif; ?>
    <?php foreach ($orders as $o): ?>
      <?php $abnormal = $o['payment_status'] === 'paid' && in_array($o['fulfillment_status'], ['failed', 'manual_review'], true); ?>
      <tr<?= $abnormal ? ' class="row-abnormal"' : '' ?>>
        <td class="mono"><?= \VoiceHubPay\Http\View::e($o['order_no']) ?></td>
        <td class="small"><?= \VoiceHubPay\Http\View::e($o['username'] ?? '—') ?></td>
        <td class="small" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><?= \VoiceHubPay\Http\View::e($o['first_item_name'] ?? '') ?></td>
        <td class="num">¥<?= \VoiceHubPay\Http\View::money((int) $o['amount_due_cents']) ?></td>
        <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'payment', 'status' => $o['payment_status']]) ?></td>
        <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'fulfillment', 'status' => $o['fulfillment_status']]) ?></td>
        <td><span class="badge badge-<?= $o['source'] === 'afdian' ? 'purple' : 'blue' ?>"><?= $o['source'] === 'afdian' ? '爱发电' : '商城' ?></span></td>
        <td class="small muted"><?= \VoiceHubPay\Http\View::datetime($o['created_at']) ?></td>
        <td><a href="/admin/orders/<?= \VoiceHubPay\Http\View::e($o['order_no']) ?>" class="btn-link">处理</a></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table></div>
</div>

<?php if ($pages > 1): ?>
  <div class="pagination">
    <?php for ($i = 1; $i <= $pages; $i++): ?>
      <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="/admin/orders?<?= \VoiceHubPay\Http\View::e(http_build_query(array_filter($f))) ?>&page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
    <?php endfor; ?>
  </div>
<?php endif; ?>
