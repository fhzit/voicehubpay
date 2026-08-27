<?php /** @var array $hot @var array $__site @var ?array $__user @var \VoiceHubPay\App $__app */
$GLOBALS['__nav'] = 'home';
?>
<section class="hero">
  <div class="container hero-grid">
    <div>
      <h1>数字商品 <span class="hl">即买即发</span><br>卡密永不丢失</h1>
      <p class="hero-lead">卡密、虚拟商品在线选购，支付后自动发货。卡密使用主密钥加密保存，登录后随时查看、随时找回。</p>
      <div class="hero-cta">
        <a href="/products" class="btn btn-primary btn-lg">浏览商品</a>
        <?php if ($__user !== null): ?>
          <a href="/account/cards" class="btn btn-outline btn-lg">我的卡券</a>
        <?php else: ?>
          <a href="/register" class="btn btn-outline btn-lg">免费注册</a>
        <?php endif; ?>
      </div>
      <div class="flex" style="gap:20px;margin-top:26px;flex-wrap:wrap;">
        <div class="flex" style="gap:8px;"><span class="status-dot status-dot-success">在线支付</span></div>
        <div class="flex" style="gap:8px;"><span class="status-dot status-dot-success">自动发货</span></div>
        <div class="flex" style="gap:8px;"><span class="status-dot status-dot-info">加密保存</span></div>
      </div>
    </div>

    <!-- 抽象产品示意卡（非 Stock Photo） -->
    <div class="hero-art" aria-hidden="true">
      <div class="hero-art-head">
        <span class="hero-art-title">订单 #VH20260827001</span>
        <span class="hero-art-status">已同步</span>
      </div>
      <div class="hero-art-row">
        <span class="mock-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg></span>
        <div style="flex:1;"><div class="mock-name">游戏加速会员 · 月卡</div><div class="mock-sub">库存卡密 · 数量 × 1</div></div>
      </div>
      <div class="hero-art-row">
        <span class="mock-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>
        <div style="flex:1;"><div class="mock-name">VoiceHub 发券</div><div class="mock-sub">shop:VH20260827001:001</div></div>
        <span class="status-dot status-dot-success">成功</span>
      </div>
      <div class="hero-art-row">
        <span class="mock-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
        <div style="flex:1;"><div class="mock-name">卡密已加密入库</div><div class="mock-sub">掩码 <span class="hero-art-mask">SG82••••A1</span></div></div>
      </div>
      <div class="hero-art-foot">
        <span class="hero-art-total">实付 <b>¥9.90</b></span>
        <span class="status-dot status-dot-success" style="font-size:12px;">卡券可随时找回</span>
      </div>
    </div>
  </div>
</section>

<div class="container" style="margin-top:8px;">
  <div class="section-head">
    <h2>热销推荐</h2>
    <a href="/products" class="btn btn-ghost btn-sm">查看全部</a>
  </div>

  <?php if ($hot === []): ?>
    <div class="card empty">
      <div class="empty-ico">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg>
      </div>
      <div class="empty-title">还没有上架商品</div>
      <div>管理员上架后即可购买</div>
    </div>
  <?php else: ?>
    <div class="product-grid">
      <?php foreach ($hot as $p): ?>
        <?php $__app->view->partial('partials/product-card', ['p' => $p]); ?>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>

  <div class="feature-grid">
    <?php $features = [
        ['shield', '安全加密', '卡密使用主密钥加密存储，永不明文入库，仅展示掩码。'],
        ['send', '自动发货', '支付成功自动调用 VoiceHub 发卡，每码一次请求，实时到账。'],
        ['lock', '随时找回', '支持账号密码、QQ、微信登录，卡券永久保存在账户中。'],
    ]; ?>
    <?php foreach ($features as $f): ?>
      <div class="card card-hover" style="text-align:center;padding:26px 20px;border-radius:var(--radius-lg);">
        <span class="empty-ico" style="background:var(--primary-soft);color:var(--primary);">
          <?php if ($f[0] === 'shield'): ?><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
          <?php elseif ($f[0] === 'send'): ?><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          <?php else: ?><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <?php endif; ?>
        </span>
        <h3 style="margin:14px 0 6px;font-size:16px;"><?= \VoiceHubPay\Http\View::e($f[1]) ?></h3>
        <p class="muted" style="margin:0;font-size:13px;line-height:1.7;"><?= \VoiceHubPay\Http\View::e($f[2]) ?></p>
      </div>
    <?php endforeach; ?>
  </div>
</div>
