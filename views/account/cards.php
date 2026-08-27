<?php /** @var array $cards @var int $total @var int $page @var int $pages @var string $status @var string $q @var \VoiceHubPay\App $__app */
$GLOBALS['__nav'] = 'cards';
// 按订单分组
$groups = [];
foreach ($cards as $c) {
    $key = (string) $c['order_no'];
    if (!isset($groups[$key])) {
        $groups[$key] = ['order_no' => $key, 'product_name' => (string) ($c['product_name_snapshot'] ?? ''), 'created_at' => (string) ($c['updated_at'] ?? $c['created_at'] ?? ''), 'items' => []];
    }
    $groups[$key]['items'][] = $c;
}
?>
<div class="page-head flex-between flex-wrap">
  <div>
    <h1 class="page-title" style="font-size:26px;">我的卡密</h1>
    <p class="page-sub">共 <?= $total ?> 个已发货卡密，卡密加密保存，点击“显示”后展示完整卡密</p>
  </div>
  <a href="/products" class="btn btn-primary btn-sm">继续购物</a>
</div>

<form method="get" action="/account/cards" class="filters">
  <select name="status" class="select" style="min-width:120px;">
    <option value="">全部状态</option>
    <option value="completed" <?= $status === 'completed' ? 'selected' : '' ?>>已发放</option>
    <option value="processing" <?= $status === 'processing' ? 'selected' : '' ?>>发放中</option>
  </select>
  <input type="text" name="q" class="input search" placeholder="搜索卡密/订单号…" value="<?= \VoiceHubPay\Http\View::e($q) ?>" style="min-width:220px;">
  <button class="btn btn-primary">筛选</button>
</form>

<?php if ($cards === []): ?>
  <div class="card empty">
    <div class="empty-ico">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    </div>
    <div class="empty-title">还没有卡密</div>
    <div>购买商品后，卡密将自动出现在这里</div>
    <div style="margin-top:14px;"><a href="/products" class="btn btn-primary btn-sm">去逛商城</a></div>
  </div>
<?php else: ?>
  <div class="code-groups">
    <?php foreach ($groups as $g): ?>
      <div class="code-group">
        <div class="code-group-head">
          <div class="flex-between flex-wrap" style="gap:8px;">
            <div style="min-width:0;">
              <div class="g-name"><?= \VoiceHubPay\Http\View::e($g['product_name'] ?: '数字商品') ?></div>
              <div class="small muted" style="margin-top:2px;"><span class="mono"><?= \VoiceHubPay\Http\View::e($g['order_no']) ?></span> · 购买于 <?= \VoiceHubPay\Http\View::datetime($g['created_at']) ?> · <?= count($g['items']) ?> 张</div>
            </div>
            <?php if (count($g['items']) > 1): ?>
              <button class="btn btn-secondary btn-sm" data-reveal-order="<?= \VoiceHubPay\Http\View::e($g['order_no']) ?>">复制全部</button>
            <?php endif; ?>
          </div>
        </div>
        <div class="code-group-body">
          <?php foreach ($g['items'] as $c): ?>
            <?php
              $done = in_array($c['status'], ['success', 'manual_completed'], true);
              $processing = in_array($c['status'], ['pending', 'processing'], true);
              $failed = in_array($c['status'], ['failed'], true);
            ?>
            <div class="code-item" style="flex-wrap:wrap;">
              <div style="min-width:0;flex:1;">
                <div class="ci-meta mono"><?= \VoiceHubPay\Http\View::e($c['unit_no']) ?>
                  <?php if ($processing): ?><span class="status-dot status-dot-info" style="margin-left:8px;">发放中</span>
                  <?php elseif ($failed): ?><span class="status-dot status-dot-danger" style="margin-left:8px;">发放异常</span>
                  <?php else: ?><span class="status-dot status-dot-success" style="margin-left:8px;">已同步</span><?php endif; ?>
                </div>
                <div class="ci-code" id="code-box-<?= (int) $c['id'] ?>"><?= \VoiceHubPay\Http\View::e($c['code_masked'] ?? '') ?></div>
              </div>
              <div class="flex" style="gap:8px;flex:none;">
                <button class="btn btn-ghost btn-sm" data-copy-target="#code-box-<?= (int) $c['id'] ?>" data-copy="__target">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                  复制
                </button>
                <?php if ($c['delivery_code_ciphertext'] !== null): ?>
                  <button class="btn btn-primary btn-sm" data-reveal-unit="<?= (int) $c['id'] ?>">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    显示
                  </button>
                <?php endif; ?>
              </div>
            </div>
          <?php endforeach; ?>
        </div>
      </div>
    <?php endforeach; ?>
  </div>

  <?php if ($pages > 1): ?>
    <div class="pagination">
      <?php for ($i = 1; $i <= $pages; $i++): ?>
        <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="/account/cards?status=<?= \VoiceHubPay\Http\View::e($status) ?>&q=<?= \VoiceHubPay\Http\View::e(urlencode($q)) ?>&page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
      <?php endfor; ?>
    </div>
  <?php endif; ?>
<?php endif; ?>
