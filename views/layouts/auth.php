<?php /** @var string $content @var array $__site */ ?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= isset($__pageTitle) ? \VoiceHubPay\Http\View::e($__pageTitle) . ' · ' : '' ?><?= \VoiceHubPay\Http\View::e($__site['name']) ?></title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%234F46E5'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>V</text></svg>">
<script>(function(){try{var t=localStorage.getItem('vhpay_theme')||'system';if(t==='dark'||(t==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();</script>
<link rel="stylesheet" href="/assets/css/app.css">
</head>
<body class="auth-page">
  <div class="auth-split">
    <div class="auth-brand-panel" aria-hidden="true">
      <div class="auth-brand-inner">
        <span class="brand-logo" style="width:46px;height:46px;font-size:21px;border-radius:13px;margin-bottom:26px;">V</span>
        <h1 class="auth-brand-title">安全、便捷的<br>账户服务。</h1>
        <p class="auth-brand-tagline">登录后即可管理您的账户信息与服务记录，重要数据加密保存，随时可查。</p>
        <div class="auth-brand-points">
          <div class="auth-brand-point">
            <span class="pico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
            <div><b>安全守护</b><span>账号信息全程加密保护，重要凭证仅本人可见</span></div>
          </div>
          <div class="auth-brand-point">
            <span class="pico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
            <div><b>加密保存</b><span>所有凭证加密入库，仅展示掩码，绝不明文留存</span></div>
          </div>
          <div class="auth-brand-point">
            <span class="pico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span>
            <div><b>随时可查</b><span>服务记录永久保存在账户中，换设备也能查到</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="auth-form-panel">
      <div class="auth-form-inner">
        <?= $content ?>
      </div>
    </div>
  </div>
  <script src="/assets/js/app.js" defer></script>
</body>
</html>
