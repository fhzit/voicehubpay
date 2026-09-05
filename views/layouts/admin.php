<?php /** @var string $content @var array $__site @var ?array $__user @var ?array $__flash @var \VoiceHubPay\App $__app */ ?>
<?php
$nav = $__nav ?? '';
$icon = static function (string $inner): string {
    return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' . $inner . '</svg>';
};
$I = [
  'dashboard' => '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  'cart' => '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  'package' => '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>',
  'tags' => '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none"/>',
  'database' => '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  'card' => '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  'send' => '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  'zap' => '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  'users' => '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'gear' => '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'key' => '<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  'shield' => '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  'list' => '<path d="M3 6h.01M3 12h.01M3 18h.01"/><path d="M8 6h13M8 12h13M8 18h13"/>',
  'mail' => '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
];
$badge = static function (string $k): string {
    $repo = $GLOBALS['__admin_badges'] ?? [];
    $n = (int) ($repo[$k] ?? 0);
    return $n > 0 ? '<span class="count">' . min(99, $n) . '</span>' : '';
};
$item = static function (string $label, string $url, string $key, string $iconPath) use ($nav, $badge, $icon) {
    $active = $nav === $key ? ' class="active"' : '';
    return '<a href="' . \VoiceHubPay\Http\View::e($url) . '"' . $active . '><span class="ico">' . $icon($iconPath) . '</span>' . $label . $badge($key) . '</a>';
};
$group = static function (string $label): string {
    return '<div class="nav-group">' . $label . '</div>';
};
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title><?= isset($__pageTitle) ? \VoiceHubPay\Http\View::e($__pageTitle) . ' · ' : '' ?>管理后台 · <?= \VoiceHubPay\Http\View::e($__site['name']) ?></title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%234F46E5'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>V</text></svg>">
<script>(function(){try{var t=localStorage.getItem('vhpay_theme')||'system';if(t==='dark'||(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();</script>
<link rel="stylesheet" href="/assets/css/app.css?v=10">
</head>
<body>
<div class="admin-shell">
  <div class="sidebar-backdrop"></div>
  <aside class="admin-sidebar">
    <a href="/admin" class="brand"><span class="brand-logo">V</span><span><?= \VoiceHubPay\Http\View::e($__site['name']) ?></span></a>
    <nav class="admin-nav" aria-label="后台导航">
      <?= $group('概览') ?>
      <?= $item('仪表盘', '/admin', 'dashboard', $I['dashboard']) ?>
      <?= $item('订单管理', '/admin/orders', 'orders', $I['cart']) ?>
      <?= $group('商品') ?>
      <?= $item('商品管理', '/admin/products', 'products', $I['package']) ?>
      <?= $item('商品分类', '/admin/categories', 'categories', $I['tags']) ?>
      <?= $item('库存卡密', '/admin/inventory', 'inventory', $I['database']) ?>
      <?= $group('渠道') ?>
      <?= $item('支付流水', '/admin/payments', 'payments', $I['card']) ?>
      <?= $item('VoiceHub 发货', '/admin/voicehub', 'voicehub', $I['send']) ?>
      <?= $item('爱发电订单', '/admin/afdian', 'afdian', $I['zap']) ?>
      <?= $group('用户') ?>
      <?= $item('用户管理', '/admin/users', 'users', $I['users']) ?>
      <?= $group('系统') ?>
      <?= $item('基础设置', '/admin/settings/general', 'settings_general', $I['gear']) ?>
      <?= $item('支付设置', '/admin/settings/payment', 'settings_payment', $I['card']) ?>
      <?= $item('登录设置', '/admin/settings/auth', 'settings_auth', $I['key']) ?>
      <?= $item('VoiceHub 设置', '/admin/settings/voicehub', 'settings_voicehub', $I['send']) ?>
      <?= $item('爱发电设置', '/admin/settings/afdian', 'settings_afdian', $I['zap']) ?>
      <?= $item('安全设置', '/admin/settings/security', 'settings_security', $I['shield']) ?>
      <?= $item('邮件设置', '/admin/settings/smtp', 'settings_smtp', $I['mail']) ?>
      <?= $item('操作日志', '/admin/audit', 'audit', $I['list']) ?>
      <?= $item('数据库', '/admin/system/database', 'system', $I['database']) ?>
    </nav>
  </aside>
  <div class="admin-main">
    <div class="admin-topbar">
      <button class="btn btn-ghost btn-icon admin-mobile-toggle" aria-label="菜单">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
      <span class="admin-title"><?= \VoiceHubPay\Http\View::e($__pageTitle ?? '管理后台') ?></span>
      <div class="flex-1"></div>
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
        <span class="avatar avatar-sm"><?= \VoiceHubPay\Http\View::e(mb_substr($__user['display_name'] ?: $__user['username'], 0, 1)) ?></span>
        <span class="small muted"><?= \VoiceHubPay\Http\View::e($__user['username']) ?></span>
        <a href="/" class="btn btn-ghost btn-sm" title="返回商城">返回商城</a>
        <form method="post" action="/logout" style="display:inline" data-confirm-title="退出登录" data-confirm="确定要退出管理后台吗？">
          <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
          <button class="btn btn-ghost btn-sm">退出</button>
        </form>
      <?php endif; ?>
    </div>
    <?php if ($__flash !== null): ?>
      <div class="flash-wrap" style="max-width:none;padding:14px 24px 0"><div class="alert alert-<?= \VoiceHubPay\Http\View::e($__flash['type'] ?? 'success') ?> flash-auto"><?= \VoiceHubPay\Http\View::e($__flash['message'] ?? '') ?></div></div>
    <?php endif; ?>
    <div class="admin-content"><?= $content ?></div>
  </div>
</div>
<script src="/assets/js/app.js?v=6" defer></script>
</body>
</html>
