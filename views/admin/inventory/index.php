<?php /** @var array $products @var ?int $product_id @var string $status @var string $q @var array $stats @var array $cards @var int $total @var int $page @var int $pages @var \VoiceHubPay\App $__app */
$__pageTitle = '库存卡密';
?>
<div class="filters">
  <form method="get" action="/admin/inventory" class="flex" style="gap:10px;flex-wrap:wrap;flex:1;">
    <select name="product" class="select" onchange="this.form.submit()">
      <option value="">全部商品</option>
      <?php foreach ($products as $p): ?>
        <?php if (in_array($p['delivery_mode'], ['card', 'card_and_voicehub'], true) || $p['delivery_mode'] === 'voicehub'): ?>
          <option value="<?= (int) $p['id'] ?>" <?= (int) $product_id === (int) $p['id'] ? 'selected' : '' ?>><?= \VoiceHubPay\Http\View::e($p['name']) ?></option>
        <?php endif; ?>
      <?php endforeach; ?>
    </select>
    <select name="status" class="select">
      <option value="">全部状态</option>
      <?php foreach (['available' => '可售', 'reserved' => '已占用', 'sold' => '已售', 'disabled' => '停用'] as $sk => $sl): ?>
        <option value="<?= $sk ?>" <?= $status === $sk ? 'selected' : '' ?>><?= $sl ?></option>
      <?php endforeach; ?>
    </select>
    <input type="text" name="q" class="input" style="max-width:240px;" value="<?= \VoiceHubPay\Http\View::e($q) ?>" placeholder="搜索卡密或商品名…">
    <button class="btn btn-secondary">筛选</button>
  </form>
  <a href="/admin/inventory/import?product=<?= (int) $product_id ?>" class="btn btn-primary">＋ 导入卡密</a>
</div>

<div class="metric-seg" style="margin-bottom:18px;">
  <div><div class="m-label">可售</div><div class="m-value" style="color:var(--success);"><?= (int) $stats['available'] ?></div></div>
  <div><div class="m-label">已占用（订单预留）</div><div class="m-value" style="color:var(--accent);"><?= (int) $stats['reserved'] ?></div></div>
  <div><div class="m-label">已售</div><div class="m-value"><?= (int) $stats['sold'] ?></div></div>
  <div><div class="m-label">停用</div><div class="m-value" style="color:var(--muted-foreground);"><?= (int) $stats['disabled'] ?></div></div>
</div>

<div class="card card-pad-0">
  <div class="table-wrap"><table class="table">
    <thead><tr><th>ID</th><th>商品</th><th>卡密（加密存储）</th><th>状态</th><th>预留订单</th><th>创建时间</th><th class="text-right">操作</th></tr></thead>
    <tbody>
    <?php if ($cards === []): ?>
      <tr><td colspan="7" class="text-center muted">暂无卡密，点击右上角“导入卡密”</td></tr>
    <?php endif; ?>
    <?php foreach ($cards as $c): ?>
      <tr>
        <td class="small mono faint">#<?= (int) $c['id'] ?></td>
        <td class="small"><?= \VoiceHubPay\Http\View::e($c['product_name'] ?? '') ?></td>
        <td class="small mono"><?= \VoiceHubPay\Http\View::e($c['secret_masked'] ?? '') ?></td>
        <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'inventory', 'status' => $c['status']]) ?></td>
        <td class="small mono"><?= $c['order_id'] ?: '—' ?></td>
        <td class="small muted"><?= \VoiceHubPay\Http\View::datetime($c['created_at']) ?></td>
        <td class="text-right">
          <?php if (in_array($c['status'], ['available', 'disabled'], true)): ?>
            <form method="post" action="/admin/inventory/<?= (int) $c['id'] ?>/status" style="display:inline;">
              <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
              <input type="hidden" name="action" value="<?= $c['status'] === 'disabled' ? 'enable' : 'disable' ?>">
              <button class="btn btn-ghost btn-sm"><?= $c['status'] === 'disabled' ? '启用' : '停用' ?></button>
            </form>
          <?php else: ?><span class="small faint">—</span><?php endif; ?>
        </td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table></div>
</div>

<?php if ($pages > 1): ?>
  <div class="pagination">
    <?php for ($i = 1; $i <= $pages; $i++): ?>
      <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="/admin/inventory?product=<?= (int) $product_id ?>&status=<?= \VoiceHubPay\Http\View::e($status) ?>&q=<?= \VoiceHubPay\Http\View::e(urlencode($q)) ?>&page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
    <?php endfor; ?>
  </div>
<?php endif; ?>
