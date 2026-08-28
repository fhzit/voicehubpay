<?php /** @var string $content @var array $__site @var ?array $__user @var ?array $__flash @var \VoiceHubPay\App $__app */
$nav = $__nav ?? ($GLOBALS['__nav'] ?? ''); ?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= isset($__pageTitle) ? \VoiceHubPay\Http\View::e($__pageTitle) . ' · ' : '' ?><?= \VoiceHubPay\Http\View::e($__site['name']) ?></title>
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%234F46E5'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>V</text></svg>">
<script>(function(){try{var t=localStorage.getItem('vhpay_theme')||'system';if(t==='dark'||(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();</script>
<link rel="stylesheet" href="/assets/css/app.css?v=5">
</head>
<body>
<nav class="shop-nav">
  <div class="container shop-nav-inner">
    <a href="/" class="brand"><span class="brand-logo">V</span><span><?= \VoiceHubPay\Http\View::e($__site['name']) ?></span></a>
    <button class="btn btn-ghost btn-icon nav-burger" aria-label="菜单">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
    </button>
    <div class="shop-nav-links">
      <a href="/" <?= $nav === 'home' ? 'class="active"' : '' ?>>首页</a>
      <a href="/products" <?= $nav === 'products' ? 'class="active"' : '' ?>>全部服务</a>
      <a href="/account/orders" <?= $nav === 'orders' ? 'class="active"' : '' ?>>我的服务</a>
      <a href="/account/cards" <?= $nav === 'cards' ? 'class="active"' : '' ?>>我的权益</a>
    </div>
    <div class="shop-nav-actions">
      <div class="theme-wrap">
      <button class="btn-icon" data-theme-toggle="theme-menu" aria-label="切换主题" title="切换主题">
        <span data-ico-sun style="display:none;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
        </span>
        <span data-ico-moon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        </span>
      </button>
      <div class="theme-menu" id="theme-menu" role="menu">
        <button type="button" data-theme-option="light" role="menuitemradio" aria-checked="false">☀ 浅色</button>
        <button type="button" data-theme-option="dark" role="menuitemradio" aria-checked="false">☾ 深色</button>
        <button type="button" data-theme-option="system" role="menuitemradio" aria-checked="false">◐ 跟随系统</button>
      </div>
      </div>
      <a href="/account" class="btn btn-secondary btn-sm user-chip" style="height:38px;"><?= \VoiceHubPay\Http\View::e($__user['display_name'] ?: $__user['username']) ?></a>
      <form method="post" action="/logout" style="display:inline" data-confirm-title="退出登录" data-confirm="确定要退出当前账号吗？">
        <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
        <button class="btn btn-ghost btn-sm" style="height:38px;">退出</button>
      </form>
    </div>
  </div>
</nav>

<?php if ($__flash !== null): ?>
  <div class="flash-wrap"><div class="alert alert-<?= \VoiceHubPay\Http\View::e($__flash['type'] ?? 'success') ?> flash-auto"><?= \VoiceHubPay\Http\View::e($__flash['message'] ?? '') ?></div></div>
<?php endif; ?>

<main>
  <div class="container">
    <div class="account-layout">
      <aside class="account-sidebar" aria-label="账户导航">
        <a href="/account" <?= $nav === 'account' ? 'class="active"' : '' ?>>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
          账户概览
        </a>
        <a href="/account/orders" <?= $nav === 'orders' ? 'class="active"' : '' ?>>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
          我的服务
        </a>
        <a href="/account/cards" <?= $nav === 'cards' ? 'class="active"' : '' ?>>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          我的权益
        </a>
        <a href="/account/connections" <?= $nav === 'connections' ? 'class="active"' : '' ?>>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          账号绑定
        </a>
        <a href="/account/security" <?= $nav === 'security' ? 'class="active"' : '' ?>>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          安全设置
        </a>
        <a href="/account/profile" <?= $nav === 'profile' ? 'class="active"' : '' ?>>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          账号资料
        </a>
        <a href="/products" style="margin-top:8px;color:var(--muted-foreground);font-size:13px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          返回服务
        </a>
      </aside>
      <div class="account-content"><?= $content ?></div>
    </div>
  </div>
</main>

<footer class="site-footer">
  <div class="container flex-between flex-wrap">
    <span>© <?= gmdate('Y') ?> <?= \VoiceHubPay\Http\View::e($__site['name']) ?></span>
  </div>
</footer>
<script src="/assets/js/app.js?v=2" defer></script>
</body>
</html>
