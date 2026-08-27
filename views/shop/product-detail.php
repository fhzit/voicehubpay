<?php /** @var array $product @var \VoiceHubPay\App $__app @var array $__site @var ?array $__user */
$GLOBALS['__nav'] = 'products';
$modeLabels = [
    'card' => '库存卡密',
    'voicehub' => 'VoiceHub 自动发券',
    'card_and_voicehub' => '库存卡密 + VoiceHub 发券',
    'manual' => '人工发货',
];
$mode = $modeLabels[$product['delivery_mode']] ?? '自动发货';
$outOfStock = (int) $product['stock_enabled'] === 1 && (int) $product['stock_available'] === 0;
$priceCents = (int) $product['price_cents'];
$minQ = max(1, (int) $product['min_quantity']);
$maxQ = max($minQ, (int) $product['max_quantity']);
$step = max(1, (int) $product['quantity_step']);
?>
<div class="container" style="padding-top:24px;">
  <nav class="small muted mb-3" style="display:flex;gap:6px;align-items:center;">
    <a href="/">首页</a><span>›</span><a href="/products">商城</a><span>›</span><span style="color:var(--muted-foreground);"><?= \VoiceHubPay\Http\View::e($product['name']) ?></span>
  </nav>

  <div class="pdp-grid">
    <!-- 左：产品视觉 -->
    <div style="min-width:0;">
      <?php if (!empty($product['cover_image'])): ?>
        <div class="pdp-visual"><img src="<?= \VoiceHubPay\Http\View::e($product['cover_image']) ?>" alt="<?= \VoiceHubPay\Http\View::e($product['name']) ?>" loading="lazy"></div>
      <?php else: ?>
        <div class="pdp-visual placeholder"><?= \VoiceHubPay\Http\View::e(mb_substr($product['name'], 0, 1)) ?></div>
      <?php endif; ?>
    </div>

    <!-- 右：购买面板 -->
    <div>
      <h1 class="pdp-title"><?= \VoiceHubPay\Http\View::e($product['name']) ?></h1>
      <div class="pdp-tags">
        <span class="badge badge-blue"><?= \VoiceHubPay\Http\View::e($mode) ?></span>
        <?php if ((int) $product['stock_enabled'] === 1): ?>
          <?php if ((int) $product['stock_available'] > 0): ?><span class="badge badge-green">库存 <?= (int) $product['stock_available'] ?> 件</span><?php else: ?><span class="badge badge-red">暂时缺货</span><?php endif; ?>
        <?php else: ?><span class="badge badge-blue">不限量 · 即时发券</span><?php endif; ?>
      </div>

      <div class="buy-panel">
        <div class="price-row">
          <span class="price-label">价格</span>
          <span class="price-big">¥<?= \VoiceHubPay\Http\View::money($priceCents) ?></span>
        </div>

        <?php if ($outOfStock): ?>
          <div class="notice notice-red">该商品暂时缺货，请稍后再来。</div>
        <?php else: ?>
          <form method="post" action="/orders" id="buy-form">
            <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
            <input type="hidden" name="product_id" value="<?= (int) $product['id'] ?>">
            <input type="hidden" name="slug" value="<?= \VoiceHubPay\Http\View::e($product['slug']) ?>">
            <div class="field">
              <label class="label">购买数量</label>
              <div class="flex" style="gap:14px;flex-wrap:wrap;">
                <div class="stepper" data-stepper data-price-cents="<?= $priceCents ?>">
                  <button type="button" data-step="-1" aria-label="减少数量">−</button>
                  <input type="number" name="quantity" id="qty" value="<?= $minQ ?>" min="<?= $minQ ?>" max="<?= $maxQ ?>" step="<?= $step ?>" inputmode="numeric">
                  <button type="button" data-step="1" aria-label="增加数量">＋</button>
                </div>
                <div class="hint" style="margin:0;align-self:center;">单次购买 <?= $minQ ?> – <?= $maxQ ?> 件<?= $step > 1 ? '，单步 ' . $step . ' 件' : '' ?></div>
              </div>
            </div>
            <div class="total-row">
              <span class="tl">合计</span>
              <span class="tv" data-total-cents>¥<?= \VoiceHubPay\Http\View::money($priceCents * $minQ) ?></span>
            </div>
            <button class="btn btn-primary btn-lg btn-block buy-cta-desktop" type="submit">
              <?= $__user !== null ? '立即购买' : '登录后购买' ?>
            </button>
            <?php if ($__user === null): ?>
              <div class="info-box">登录后可永久查看历史购买卡券，卡密加密保存，随时找回。</div>
            <?php endif; ?>
          </form>
        <?php endif; ?>
      </div>

      <div class="card" style="margin-top:24px;">
        <h3 class="card-title mb-2">商品说明</h3>
        <?php if (!empty($product['description'])): ?>
          <div style="white-space:pre-wrap;color:var(--foreground-secondary);font-size:14px;line-height:1.8;"><?= \VoiceHubPay\Http\View::e($product['description']) ?></div>
        <?php else: ?>
          <p class="muted" style="margin:0;">暂无详细说明，购买后将自动发货。</p>
        <?php endif; ?>
      </div>
    </div>
  </div>
</div>

<?php if (!$outOfStock): ?>
<div class="mobile-buybar">
  <span class="mb-price"><span data-total-cents style="font-size:20px;">¥<?= \VoiceHubPay\Http\View::money($priceCents * $minQ) ?></span></span>
  <button class="btn btn-primary mb-cta" style="height:44px;" type="submit" form="buy-form"><?= $__user !== null ? '立即购买' : '登录后购买' ?></button>
</div>
<?php endif; ?>
