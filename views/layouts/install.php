<?php /** @var string $content @var array $__site */ ?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>安装向导 · <?= \VoiceHubPay\Http\View::e($__site['name'] ?? 'VoiceHubPay') ?></title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%234F46E5'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>V</text></svg>">
<script>(function(){try{var t=localStorage.getItem('vhpay_theme')||'system';if(t==='dark'||(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();</script>
<link rel="stylesheet" href="/assets/css/app.css">
</head>
<body class="install-page">
  <div class="install-shell">
    <div class="install-head">
      <span class="brand-logo">V</span>
      <h1>VoiceHubPay 安装向导</h1>
      <p>系统初始化工具 · 升级过程安全，旧数据不会丢失</p>
    </div>
    <?= $content ?>
  </div>
  <script src="/assets/js/app.js" defer></script>
</body>
</html>
