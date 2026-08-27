<?php /** @var string $redirect @var bool $qq_enabled @var bool $wx_enabled @var ?array $__flash @var \VoiceHubPay\App $__app */ ?>
<div class="auth-logo">
  <span class="brand-logo">V</span>
  <span style="font-size:15px;font-weight:700;color:var(--foreground);"><?= \VoiceHubPay\Http\View::e($__site['name'] ?? 'VoiceHubPay') ?></span>
</div>

<h1 class="auth-title">欢迎回来</h1>
<p class="auth-sub">登录后查看订单、卡密与绑定方式</p>

<?php if ($__flash !== null): ?>
  <div class="alert alert-<?= \VoiceHubPay\Http\View::e($__flash['type'] ?? 'success') ?>" style="margin-bottom:16px;"><?= \VoiceHubPay\Http\View::e($__flash['message'] ?? '') ?></div>
<?php endif; ?>

<?php if ($qq_enabled || $wx_enabled): ?>
  <div class="social-btns" style="margin-bottom:18px;">
    <?php if ($qq_enabled): ?>
      <a href="/auth/social/qq?redirect=<?= \VoiceHubPay\Http\View::e(urlencode($redirect)) ?>" class="social-btn">
        <span class="sico" style="color:#12B7F5;font-weight:800;font-size:13px;letter-spacing:-.02em;">QQ</span>QQ 登录
      </a>
    <?php endif; ?>
    <?php if ($wx_enabled): ?>
      <a href="/auth/social/wx?redirect=<?= \VoiceHubPay\Http\View::e(urlencode($redirect)) ?>" class="social-btn">
        <span class="sico" style="color:#07C160;"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 4C5.36 4 2 6.8 2 10.24c0 1.98 1.06 3.74 2.73 4.9l-.68 2.13 2.37-1.22c.76.21 1.57.33 2.42.33.22 0 .43-.01.64-.03a5.6 5.6 0 0 1-.28-1.78c0-3.18 3.13-5.75 7-5.75.35 0 .7.02 1.03.06C16.9 6.02 13.5 4 9.5 4Zm-2.6 3.6a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7Zm5.2 0a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7ZM22 14.2c0-2.76-2.8-5-6.25-5s-6.25 2.24-6.25 5 2.8 5 6.25 5c.65 0 1.28-.09 1.87-.25l1.97 1.02-.57-1.78A4.94 4.94 0 0 0 22 14.2Zm-8.6-1.75a.72.72 0 1 1 0 1.44.72.72 0 0 1 0-1.44Zm4.7 0a.72.72 0 1 1 0 1.44.72.72 0 0 1 0-1.44Z"/></svg></span>微信登录
      </a>
    <?php endif; ?>
  </div>
  <div class="auth-divider">或使用账号密码</div>
<?php endif; ?>

<form method="post" action="/auth/password/login">
  <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
  <input type="hidden" name="redirect" value="<?= \VoiceHubPay\Http\View::e($redirect) ?>">
  <div class="field">
    <label class="label" for="username">用户名</label>
    <input class="input" type="text" id="username" name="username" required autocomplete="username" autofocus>
  </div>
  <div class="field">
    <label class="label" for="password">密码</label>
    <input class="input" type="password" id="password" name="password" required autocomplete="current-password">
  </div>
  <button class="btn btn-primary btn-lg btn-block" style="margin-top:6px;">登 录</button>
</form>

<div class="text-center small muted" style="margin-top:22px;">还没有账号？<a href="/register">立即注册</a></div>
