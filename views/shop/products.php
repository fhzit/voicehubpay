<?php /** @var array $categories @var array $products @var int $total @var int $page @var int $pages @var array $filters @var \VoiceHubPay\App $__app */
$GLOBALS['__nav'] = 'products';
$query = http_build_query(array_filter(['category' => $filters['category_id'], 'q' => $filters['q'], 'sort' => $filters['sort']]));
$base = '/products?' . $query;
?>
<div class="container" style="padding-top:32px;">
  <div class="page-head flex-between flex-wrap">
    <div>
      <h1 class="page-title">商城</h1>
      <p class="page-sub">选择你需要的数字商品，支付后自动发货</p>
    </div>
    <span class="small muted">共 <?= $total ?> 件商品</span>
  </div>

  <!-- Filter Toolbar -->
  <div class="filters">
    <form method="get" action="/products" class="flex" style="gap:10px;flex-wrap:wrap;flex:1;margin:0;">
      <input type="hidden" name="sort" value="<?= \VoiceHubPay\Http\View::e($filters['sort']) ?>">
      <select name="category" class="select" style="min-width:130px;">
        <option value="">全部分类</option>
        <?php foreach ($categories as $c): ?>
          <option value="<?= (int) $c['id'] ?>" <?= (int) $filters['category_id'] === (int) $c['id'] ? 'selected' : '' ?>><?= \VoiceHubPay\Http\View::e($c['name']) ?></option>
        <?php endforeach; ?>
      </select>
      <input type="text" name="q" class="input search" placeholder="搜索商品名称…" value="<?= \VoiceHubPay\Http\View::e($filters['q']) ?>" style="min-width:220px;">
      <button class="btn btn-primary">搜索</button>
    </form>
    <div class="seg" aria-label="排序">
      <?php foreach (['recommend' => '推荐', 'newest' => '最新', 'price_asc' => '价格↑', 'price_desc' => '价格↓', 'sales' => '销量'] as $k => $label): ?>
        <a class="seg-item <?= $filters['sort'] === $k ? 'active' : '' ?>" href="/products?<?= \VoiceHubPay\Http\View::e(http_build_query(array_filter(['category' => $filters['category_id'], 'q' => $filters['q'], 'sort' => $k]))) ?>"><?= $label ?></a>
      <?php endforeach; ?>
    </div>
  </div>

  <?php if ($products === []): ?>
    <div class="card empty">
      <div class="empty-ico">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </div>
      <div class="empty-title">没有找到相关商品</div>
      <div>换个关键词或分类试试</div>
    </div>
  <?php else: ?>
    <div class="product-grid">
      <?php foreach ($products as $p): ?>
        <?= $__app->view->partial('partials/product-card', ['p' => $p]) ?>
      <?php endforeach; ?>
    </div>
    <?php if ($pages > 1): ?>
      <div class="pagination">
        <?php if ($page > 1): ?><a href="<?= \VoiceHubPay\Http\View::e($base) ?>&page=<?= $page - 1 ?>">‹</a><?php endif; ?>
        <?php for ($i = max(1, $page - 2); $i <= min($pages, $page + 2); $i++): ?>
          <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="<?= \VoiceHubPay\Http\View::e($base) ?>&page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
        <?php endfor; ?>
        <?php if ($page < $pages): ?><a href="<?= \VoiceHubPay\Http\View::e($base) ?>&page=<?= $page + 1 ?>">›</a><?php endif; ?>
      </div>
    <?php endif; ?>
  <?php endif; ?>
</div>
