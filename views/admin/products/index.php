<?php /** @var array $products @var int $total @var int $page @var int $pages @var string $q @var string $status @var ?int $category_id @var array $categories @var \VoiceHubPay\App $__app */
$__pageTitle = '商品管理';
$modeLabels = ['card' => '库存卡密', 'voicehub' => 'VoiceHub 发券', 'card_and_voicehub' => '卡密+发券', 'manual' => '人工发货'];
?>
<div class="filters">
  <form method="get" action="/admin/products" class="flex" style="gap:10px;flex-wrap:wrap;flex:1;">
    <input type="text" name="q" class="input search" placeholder="搜索商品…" value="<?= \VoiceHubPay\Http\View::e($q) ?>">
    <select name="status" class="select">
      <option value="">全部状态</option>
      <?php foreach (['active' => '上架', 'draft' => '草稿', 'disabled' => '下架'] as $sk => $sl): ?>
        <option value="<?= $sk ?>" <?= $status === $sk ? 'selected' : '' ?>><?= $sl ?></option>
      <?php endforeach; ?>
    </select>
    <select name="category" class="select">
      <option value="">全部分类</option>
      <?php foreach ($categories as $c): ?>
        <option value="<?= (int) $c['id'] ?>" <?= (int) $category_id === (int) $c['id'] ? 'selected' : '' ?>><?= \VoiceHubPay\Http\View::e($c['name']) ?></option>
      <?php endforeach; ?>
    </select>
    <button class="btn btn-secondary">筛选</button>
  </form>
  <a href="/admin/products/create" class="btn btn-primary">＋ 新建商品</a>
</div>

<div class="card card-pad-0">
  <div class="table-wrap"><table class="table">
    <thead><tr><th>商品</th><th>分类</th><th>售价</th><th>发货方式</th><th>销量</th><th>营收</th><th>库存</th><th>状态</th><th class="text-right">操作</th></tr></thead>
    <tbody>
    <?php if ($products === []): ?>
      <tr><td colspan="9" class="text-center muted">暂无商品，点击右上角“新建商品”创建</td></tr>
    <?php endif; ?>
    <?php foreach ($products as $p): ?>
      <tr>
        <td style="min-width:200px;">
          <div class="flex" style="gap:10px;align-items:center;">
            <span class="prod-thumb"><?php if (!empty($p['cover'])): ?><img src="<?= \VoiceHubPay\Http\View::e($p['cover']) ?>" alt=""><?php else: ?><?= \VoiceHubPay\Http\View::e(mb_substr($p['name'], 0, 1)) ?><?php endif; ?></span>
            <div>
              <div style="font-weight:600;"><?= \VoiceHubPay\Http\View::e($p['name']) ?></div>
              <div class="small mono faint">/product/<?= \VoiceHubPay\Http\View::e($p['slug']) ?></div>
            </div>
          </div>
        </td>
        <td class="small"><?= \VoiceHubPay\Http\View::e($p['category_name'] ?? '—') ?></td>
        <td class="num">¥<?= \VoiceHubPay\Http\View::money((int) $p['price_cents']) ?></td>
        <td><span class="badge badge-blue"><?= \VoiceHubPay\Http\View::e($modeLabels[$p['delivery_mode']] ?? $p['delivery_mode']) ?></span></td>
        <td class="num"><?= (int) $p['sold_units'] ?></td>
        <td class="num">¥<?= \VoiceHubPay\Http\View::money((int) $p['revenue_cents']) ?></td>
        <td class="num"><?= (int) $p['stock_available'] ?></td>
        <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'status', 'status' => $p['status']]) ?></td>
        <td class="text-right">
          <div class="flex" style="justify-content:flex-end;gap:6px;">
            <a href="/admin/products/edit/<?= (int) $p['id'] ?>" class="btn btn-secondary btn-sm">编辑</a>
            <form method="post" action="/admin/products/<?= (int) $p['id'] ?>/status" style="display:inline;">
              <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
              <button class="btn btn-ghost btn-sm"><?= $p['status'] === 'active' ? '下架' : '上架' ?></button>
            </form>
            <form method="post" action="/admin/products/<?= (int) $p['id'] ?>/delete" data-confirm="确定删除商品「<?= \VoiceHubPay\Http\View::e($p['name']) ?>」吗？有订单历史的商品将转为下架。" style="display:inline;">
              <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
              <button class="btn btn-danger btn-sm">删除</button>
            </form>
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
      <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="/admin/products?q=<?= \VoiceHubPay\Http\View::e(urlencode($q)) ?>&status=<?= \VoiceHubPay\Http\View::e($status) ?>&category=<?= (int) $category_id ?>&page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
    <?php endfor; ?>
  </div>
<?php endif; ?>
