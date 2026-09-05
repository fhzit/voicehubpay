<?php /** @var array $hot @var bool $showHot @var array $__site @var ?array $__user @var \VoiceHubPay\App $__app */
$GLOBALS['__nav'] = 'home';
?>
<section class="hero">
  <div class="container hero-grid">
    <div>
      <h1>数字服务 <span class="hl">即选即享</span><br>凭证安全保存</h1>
      <p class="hero-lead">开通后即时生效，凭证加密保存，登录后随时查看、随时找回。</p>
      <div class="hero-cta">
        <a href="/products" class="btn btn-primary btn-lg">浏览服务</a>
        <?php if ($__user !== null): ?>
          <a href="/account/cards" class="btn btn-outline btn-lg">我的凭证</a>
        <?php else: ?>
          <a href="<?= \VoiceHubPay\Http\View::e($__site['auth_register']) ?>" class="btn btn-outline btn-lg">免费注册</a>
        <?php endif; ?>
      </div>
      <div class="flex" style="gap:20px;margin-top:26px;flex-wrap:wrap;">
        <div class="flex" style="gap:8px;"><span class="status-dot status-dot-success">即开即用</span></div>
        <div class="flex" style="gap:8px;"><span class="status-dot status-dot-info">加密保存</span></div>
        <div class="flex" style="gap:8px;"><span class="status-dot status-dot-info">随时可查</span></div>
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
        <div style="flex:1;"><div class="mock-name">视频加速服务</div><div class="mock-sub">账户服务 · 数量 × 1</div></div>
      </div>
      <div class="hero-art-row">
        <span class="mock-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></span>
        <div style="flex:1;"><div class="mock-name">权益已开通</div><div class="mock-sub">订单 VH20260827001 · 同步成功</div></div>
        <span class="status-dot status-dot-success">成功</span>
      </div>
      <div class="hero-art-row">
        <span class="mock-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
        <div style="flex:1;"><div class="mock-name">凭证已加密保存</div><div class="mock-sub">凭证号 <span class="hero-art-mask">SG82••••A1</span></div></div>
      </div>
      <div class="hero-art-foot">
        <span class="hero-art-total">多账号 · 多设备</span>
        <span class="status-dot status-dot-success" style="font-size:12px;">随时可查</span>
      </div>
    </div>
  </div>
</section>

<div class="container" style="margin-top:8px;">
  <?php if ($showHot): ?>
  <div class="section-head">
    <h2>热门服务</h2>
    <a href="/products" class="btn btn-ghost btn-sm">查看全部</a>
  </div>

  <?php if ($hot === []): ?>
    <div class="card empty">
      <div class="empty-ico">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg>
      </div>
      <div class="empty-title">还没有上架服务</div>
      <div>开通后即可查看</div>
    </div>
  <?php else: ?>
    <div class="product-grid">
      <?php foreach ($hot as $p): ?>
        <?= $__app->view->partial('partials/product-card', ['p' => $p]) ?>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>
  <?php endif; ?>

  <div class="feature-grid">
    <?php $features = [
        ['shield', '安全可靠', '凭证与账号信息加密保存，重要数据受保护，长期稳定运行。'],
        ['send', '即开即用', '开通即时生效，无需等待，操作简单流畅。'],
        ['lock', '随时可查', '支持账号密码、QQ、微信登录，记录与凭证永久保存在账户中。'],
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
