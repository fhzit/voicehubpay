<?php /** @var array $orders @var int $total @var int $page @var int $pages @var string $status @var string $voicehub @var string $q @var array $stats @var \VoiceHubPay\App $__app */
$__pageTitle = '爱发电订单';
?>
<div class="page-head flex-between flex-wrap">
  <div><h1 class="page-title">爱发电订单</h1></div>
  <form method="post" action="/admin/afdian/sync" data-confirm="将拉取爱发电最近订单并同步，确认？">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <button class="btn btn-primary">手动同步</button>
  </form>
</div>

<div class="stat-grid" style="margin-bottom:16px;grid-template-columns:repeat(4,1fr);">
  <div class="stat-card"><div class="stat-label">累计营收</div><div class="stat-value">¥<?= \VoiceHubPay\Http\View::money((int) $stats['sum']) ?></div></div>
  <div class="stat-card"><div class="stat-label">今日订单</div><div class="stat-value"><?= (int) $stats['today_orders'] ?></div></div>
  <div class="stat-card"><div class="stat-label">VoiceHub 已成功</div><div class="stat-value" style="color:var(--green);"><?= (int) ($stats['voicehub']['success'] ?? 0) ?></div></div>
  <div class="stat-card"><div class="stat-label">VoiceHub 失败</div><div class="stat-value" style="color:var(--red);"><?= (int) ($stats['voicehub']['failed'] ?? 0) ?></div></div>
</div>

<div class="filters">
  <form method="get" action="/admin/afdian" class="flex" style="gap:10px;flex-wrap:wrap;flex:1;">
    <input type="text" name="q" class="input search" placeholder="订单号/买家" value="<?= \VoiceHubPay\Http\View::e($q) ?>">
    <select name="status" class="select">
      <option value="">全部支付状态</option>
      <?php foreach (['paid' => '已支付', 'unpaid' => '未支付', 'pending' => '处理中'] as $sk => $sl): ?>
        <option value="<?= $sk ?>" <?= $status === $sk ? 'selected' : '' ?>><?= $sl ?></option>
      <?php endforeach; ?>
    </select>
    <select name="voicehub" class="select">
      <option value="">全部推送状态</option>
      <?php foreach (['success' => '已成功', 'failed' => '失败', 'pending' => '待推送'] as $sk => $sl): ?>
        <option value="<?= $sk ?>" <?= $voicehub === $sk ? 'selected' : '' ?>><?= $sl ?></option>
      <?php endforeach; ?>
    </select>
    <button class="btn btn-secondary">筛选</button>
  </form>
</div>

<div class="card card-pad-0">
  <div class="table-wrap"><table class="table">
    <thead><tr><th>订单号</th><th>买家</th><th class="num">金额</th><th>推送</th><th>尝试</th><th>时间</th><th></th></tr></thead>
    <tbody>
    <?php if ($orders === []): ?>
      <tr><td colspan="7" class="text-center muted">暂无爱发电订单</td></tr>
    <?php endif; ?>
    <?php foreach ($orders as $o): ?>
      <tr>
        <td class="mono"><?= \VoiceHubPay\Http\View::e($o['out_trade_no']) ?></td>
        <td class="small"><?= \VoiceHubPay\Http\View::e($o['buyer_name'] ?? '') ?></td>
        <td class="num">¥<?= \VoiceHubPay\Http\View::money((int) $o['amount_cents']) ?></td>
        <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'voicehub', 'status' => $o['voicehub_status']]) ?></td>
        <td><?= (int) $o['voicehub_attempts'] ?></td>
        <td class="small muted"><?= \VoiceHubPay\Http\View::datetime($o['created_at']) ?></td>
        <td>
          <?php if ($o['status'] === 'paid' && $o['voicehub_status'] !== 'success'): ?>
            <form method="post" action="/admin/afdian/retry" data-confirm="确认重新推送 out_trade_no = <?= \VoiceHubPay\Http\View::e($o['out_trade_no']) ?>？">
              <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
              <input type="hidden" name="out_trade_no" value="<?= \VoiceHubPay\Http\View::e($o['out_trade_no']) ?>">
              <button class="btn btn-secondary btn-sm">重试</button>
            </form>
          <?php endif; ?>
        </td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table></div>
</div>

<?php if ($pages > 1): ?>
  <div class="pagination">
    <?php for ($i = 1; $i <= $pages; $i++): ?>
      <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="/admin/afdian?status=<?= \VoiceHubPay\Http\View::e($status) ?>&voicehub=<?= \VoiceHubPay\Http\View::e($voicehub) ?>&q=<?= \VoiceHubPay\Http\View::e(urlencode($q)) ?>&page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
    <?php endfor; ?>
  </div>
<?php endif; ?>
