<?php /** @var string $content @var array $__site @var ?array $__user @var ?array $__flash @var \VoiceHubPay\App $__app */
$nav = $__nav ?? ($GLOBALS['__nav'] ?? ''); ?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= isset($__pageTitle) ? \VoiceHubPay\Http\View::e($__pageTitle) . ' · ' : '' ?><?= \VoiceHubPay\Http\View::e($__site['name']) ?></title>
<meta name="description" content="安全便捷的账户服务，凭证加密保存，登录后随时管理您的服务记录。">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%234F46E5'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>V</text></svg>">
<script>(function(){try{var t=localStorage.getItem('vhpay_theme')||'system';if(t==='dark'||(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();</script>
<link rel="stylesheet" href="/assets/css/app.css?v=10">
<?php $__stat = trim((string) $__app->config->get('SITE_STAT_CODE', '')); if ($__stat !== ''): ?>
<?= $__stat ?>
<?php endif; ?>
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
      <?php if ($__user !== null): ?>
      <a href="/account/orders" <?= $nav === 'orders' ? 'class="active"' : '' ?>>我的服务</a>
      <a href="/account/cards" <?= $nav === 'cards' ? 'class="active"' : '' ?>>我的权益</a>
      <?php endif; ?>
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
      <?php if ($__user !== null): ?>
        <a href="/account" class="btn btn-secondary btn-sm user-chip" style="height:38px;"><?= \VoiceHubPay\Http\View::e($__user['display_name'] ?: $__user['username']) ?></a>
        <form method="post" action="/logout" style="display:inline" data-confirm-title="退出登录" data-confirm="确定要退出当前账号吗？">
          <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
          <button class="btn btn-ghost btn-sm" style="height:38px;">退出</button>
        </form>
      <?php else: ?>
        <a href="/login" class="btn btn-ghost btn-sm user-chip">登录</a>
        <a href="/register" class="btn btn-primary btn-sm">注册</a>
      <?php endif; ?>
    </div>
  </div>
</nav>

<?php if ($__flash !== null): ?>
  <div class="flash-wrap"><div class="alert alert-<?= \VoiceHubPay\Http\View::e($__flash['type'] ?? 'success') ?> flash-auto"><?= \VoiceHubPay\Http\View::e($__flash['message'] ?? '') ?></div></div>
<?php endif; ?>

<main><?= $content ?></main>

<footer class="site-footer">
  <div class="container flex-between flex-wrap">
    <?php $__beian = trim((string) $__app->config->get('ICP_BEIAN_NO', '')); if ($__beian !== ''): ?>
    <div class="site-footer-meta beian-line">
      <a href="https://beian.miit.gov.cn/" class="beian-link" target="_blank" rel="noopener noreferrer"><?= \VoiceHubPay\Http\View::e($__beian) ?></a>
      <span class="beian-sep">|</span>
      <span>© <?= gmdate('Y') ?> <?= \VoiceHubPay\Http\View::e($__site['name']) ?></span>
    </div>
    <?php else: ?>
    <span>© <?= gmdate('Y') ?> <?= \VoiceHubPay\Http\View::e($__site['name']) ?></span>
    <?php endif; ?>
  </div>
</footer>
<script src="/assets/js/app.js?v=6" defer></script>
</body>
</html>
