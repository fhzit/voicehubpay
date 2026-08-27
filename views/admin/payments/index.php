<?php /** @var array $transactions @var int $total @var int $page @var int $pages @var string $pay_type @var string $status @var string $q @var \VoiceHubPay\App $__app */
$__pageTitle = '支付流水';
?>
<div class="filters">
  <form method="get" action="/admin/payments" class="flex" style="gap:10px;flex-wrap:wrap;flex:1;">
    <input type="text" name="q" class="input" placeholder="商户单号/平台单号" value="<?= \VoiceHubPay\Http\View::e($q) ?>">
    <select name="pay_type" class="select">
      <option value="">全部支付方式</option>
      <?php foreach (['alipay' => '支付宝', 'wxpay' => '微信支付', 'qqpay' => 'QQ 钱包'] as $tk => $tl): ?>
        <option value="<?= $tk ?>" <?= $pay_type === $tk ? 'selected' : '' ?>><?= $tl ?></option>
      <?php endforeach; ?>
    </select>
    <select name="status" class="select">
      <option value="">全部状态</option>
      <?php foreach (['unpaid' => '未支付', 'paid' => '已支付', 'pending' => '待确认'] as $sk => $sl): ?>
        <option value="<?= $sk ?>" <?= $status === $sk ? 'selected' : '' ?>><?= $sl ?></option>
      <?php endforeach; ?>
    </select>
    <button class="btn btn-secondary">筛选</button>
  </form>
</div>

<div class="card card-pad-0">
  <div class="table-wrap"><table class="table">
    <thead><tr><th>商户单号</th><th>订单</th><th>支付方式</th><th class="num">金额</th><th>状态</th><th>确认来源</th><th>时间</th></tr></thead>
    <tbody>
    <?php if ($transactions === []): ?>
      <tr><td colspan="7" class="text-center muted">暂无支付流水</td></tr>
    <?php endif; ?>
    <?php foreach ($transactions as $t): ?>
      <tr>
        <td class="mono small"><?= \VoiceHubPay\Http\View::e($t['merchant_order_no'] ?? '') ?></td>
        <td class="small"><a href="/admin/orders/<?= \VoiceHubPay\Http\View::e($t['order_no'] ?? '') ?>"><?= \VoiceHubPay\Http\View::e($t['order_no'] ?? '—') ?></a></td>
        <td><span class="badge badge-blue"><?= \VoiceHubPay\Http\View::e($t['pay_type']) ?></span></td>
        <td class="num">¥<?= \VoiceHubPay\Http\View::money((int) $t['amount_cents']) ?></td>
        <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'payment', 'status' => $t['status']]) ?></td>
        <td class="small"><?= \VoiceHubPay\Http\View::e($t['confirmation_source'] ?? '') ?></td>
        <td class="small muted"><?= \VoiceHubPay\Http\View::datetime($t['created_at']) ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table></div>
</div>

<?php if ($pages > 1): ?>
  <div class="pagination">
    <?php for ($i = 1; $i <= $pages; $i++): ?>
      <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="/admin/payments?pay_type=<?= \VoiceHubPay\Http\View::e($pay_type) ?>&status=<?= \VoiceHubPay\Http\View::e($status) ?>&q=<?= \VoiceHubPay\Http\View::e(urlencode($q)) ?>&page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
    <?php endfor; ?>
  </div>
<?php endif; ?>
