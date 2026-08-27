<?php /** @var array $p */ ?>
<div class="product-card">
  <a href="/product/<?= \VoiceHubPay\Http\View::e($p['slug']) ?>" class="product-cover">
    <?php if (!empty($p['cover_image'])): ?>
      <img src="<?= \VoiceHubPay\Http\View::e($p['cover_image']) ?>" alt="<?= \VoiceHubPay\Http\View::e($p['name']) ?>" loading="lazy">
    <?php else: ?>
      <?= \VoiceHubPay\Http\View::e(mb_substr($p['name'], 0, 1)) ?>
    <?php endif; ?>
  </a>
  <div class="product-info">
    <h3 class="product-name"><a href="/product/<?= \VoiceHubPay\Http\View::e($p['slug']) ?>"><?= \VoiceHubPay\Http\View::e($p['name']) ?></a></h3>
    <?php if (!empty($p['description'])): ?>
      <p class="product-desc"><?= \VoiceHubPay\Http\View::e($p['description']) ?></p>
    <?php endif; ?>
    <div class="product-meta">
      <span class="product-price"><small>¥</small><?= \VoiceHubPay\Http\View::money((int) $p['price_cents']) ?></span>
      <span class="product-stock <?= ((int) $p['stock_enabled'] === 1) ? ((int) $p['stock_available'] === 0 ? 'out' : ((int) $p['stock_available'] <= 5 ? 'low' : '')) : '' ?>">
        <?php if ((int) $p['stock_enabled'] === 1): ?>
          <?php if ((int) $p['stock_available'] > 0): ?>库存 <?= (int) $p['stock_available'] ?><?php else: ?>暂时缺货<?php endif; ?>
        <?php else: ?>即时发货<?php endif; ?>
      </span>
    </div>
    <?php if ((int) $p['stock_enabled'] === 1 && (int) $p['stock_available'] === 0): ?>
      <a href="/product/<?= \VoiceHubPay\Http\View::e($p['slug']) ?>" class="btn btn-secondary btn-block" style="height:36px;pointer-events:none;opacity:.6;">暂时缺货</a>
    <?php else: ?>
      <a href="/product/<?= \VoiceHubPay\Http\View::e($p['slug']) ?>" class="btn btn-primary btn-block" style="height:36px;">立即购买</a>
    <?php endif; ?>
  </div>
</div>
