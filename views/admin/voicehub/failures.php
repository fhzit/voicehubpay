<?php /** @var array $deliveries @var int $total @var int $page @var int $pages @var \VoiceHubPay\App $__app */
$__pageTitle = 'VoiceHub 失败中心';
$sourceLabels = ['inventory' => '库存卡密', 'shop_order_no' => '商城订单号', 'afdian_order_no' => '爱发电订单号'];
?>
<div class="page-head flex-between flex-wrap">
  <div><h1 class="page-title">失败中心</h1><p class="page-sub">共 <?= $total ?> 条失败推送，可逐条重试或批量处理</p></div>
  <form method="post" action="/admin/voicehub/retry-all" data-confirm="将逐个重试所有失败推送（每个 code 一次请求），确认继续？">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <button class="btn btn-primary">批量重试全部失败</button>
  </form>
</div>

<div class="notice notice-red" style="margin-bottom:18px;">共 <strong><?= $total ?></strong> 条推送失败。重试会复用原券码逐个重新调用 VoiceHub，每个 code 一次请求，不会产生重复卡券。</div>

<div class="card card-pad-0">
  <div class="table-wrap"><table class="table">
    <thead><tr><th>ID</th><th>来源单号</th><th>来源</th><th>码（掩码）</th><th>尝试</th><th>错误</th><th>最后时间</th><th></th></tr></thead>
    <tbody>
    <?php if ($deliveries === []): ?>
      <tr><td colspan="8" class="text-center muted">暂无失败记录</td></tr>
    <?php endif; ?>
    <?php foreach ($deliveries as $d): ?>
      <tr>
        <td class="small mono faint">#<?= (int) $d['id'] ?></td>
        <td class="mono small"><?= \VoiceHubPay\Http\View::e($d['source_order_no']) ?></td>
        <td class="small"><?= \VoiceHubPay\Http\View::e($sourceLabels[$d['code_source']] ?? $d['code_source']) ?></td>
        <td class="mono small"><?= \VoiceHubPay\Http\View::e($d['code_masked']) ?></td>
        <td class="small" style="color:<?= (int) $d['attempts'] > 3 ? 'var(--warning)' : 'var(--foreground-secondary)' ?>;font-weight:600;"><?= (int) $d['attempts'] ?></td>
        <td class="small" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="<?= \VoiceHubPay\Http\View::e($d['last_error'] ?? '') ?>"><?= \VoiceHubPay\Http\View::e($d['last_error'] ?? '') ?></td>
        <td class="small muted"><?= \VoiceHubPay\Http\View::datetime($d['updated_at']) ?></td>
        <td>
          <form method="post" action="/admin/voicehub/retry" style="display:inline;">
            <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
            <input type="hidden" name="delivery_id" value="<?= (int) $d['id'] ?>">
            <button class="btn btn-secondary btn-sm">重试</button>
          </form>
          <?php if ($d['fulfillment_unit_id'] !== null): ?>
            <a href="/admin/orders/<?= \VoiceHubPay\Http\View::e($d['shop_order_no'] ?? '') ?>" class="btn-link small">订单</a>
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
      <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="/admin/voicehub/failures?page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
    <?php endfor; ?>
  </div>
<?php endif; ?>
