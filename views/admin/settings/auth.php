<?php /** @var array $settings @var string $qq_key_placeholder @var string $wx_key_placeholder @var string $qq_callback @var string $wx_callback @var \VoiceHubPay\App $__app */
$__pageTitle = '登录设置';
$get = static fn (string $k, string $d = '') => (string) ($settings[$k] ?? $d);
?>
<div class="settings-layout">
<div class="settings-nav">
  <span class="nav-group" style="padding:4px 12px 8px;">设置</span>
  <a href="/admin/settings/general">基础设置</a>
  <a href="/admin/settings/payment">支付设置</a>
  <a href="/admin/settings/auth" class="active">登录设置</a>
  <a href="/admin/settings/voicehub">VoiceHub 设置</a>
  <a href="/admin/settings/afdian">爱发电设置</a>
  <a href="/admin/settings/security">安全设置</a>
</div>
<div class="settings-column" style="min-width:0;">
<div class="settings-section" style="max-width:840px;">
  <h3 class="card-title mb-4">登录方式</h3>
  <form method="post" action="/admin/settings/auth">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <div class="field checkbox-row">
      <input type="checkbox" name="registration_enabled" id="registration_enabled" value="1" <?= $get('REGISTRATION_ENABLED', '1') === '1' ? 'checked' : '' ?>>
      <label for="registration_enabled" class="small muted">开放账号密码自助注册</label>
    </div>

    <hr style="border:none;border-top:1px solid var(--border);margin:20px 0;">

    <div class="field checkbox-row">
      <input type="checkbox" name="qq_enabled" id="qq_enabled" value="1" <?= $get('QQ_LOGIN_ENABLED', '0') === '1' ? 'checked' : '' ?>>
      <label for="qq_enabled" class="small muted"><strong>启用 QQ 登录</strong>（QQ 互联开放平台）</label>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">QQ App ID</label>
        <input class="input" type="text" name="qq_app_id" value="<?= \VoiceHubPay\Http\View::e($get('QQ_APP_ID')) ?>" autocomplete="off">
      </div>
      <div class="field">
        <label class="label">QQ App Key</label>
        <input class="input" type="text" name="qq_app_key" value="" placeholder="<?= \VoiceHubPay\Http\View::e($qq_key_placeholder) ?>" autocomplete="off">
        <div class="hint"><?= $qq_key_placeholder ? '已配置，留空表示不修改。' : 'AppKey 加密存储。' ?></div>
      </div>
    </div>
    <div class="field">
      <label class="label">QQ 回调地址（在 QQ 互联后台填写）</label>
      <div class="small"><code class="inline mono"><?= \VoiceHubPay\Http\View::e($qq_callback) ?></code></div>
    </div>

    <hr style="border:none;border-top:1px solid var(--border);margin:20px 0;">

    <div class="field checkbox-row">
      <input type="checkbox" name="wx_enabled" id="wx_enabled" value="1" <?= $get('WX_LOGIN_ENABLED', '0') === '1' ? 'checked' : '' ?>>
      <label for="wx_enabled" class="small muted"><strong>启用微信登录</strong>（开放平台扫码登录）</label>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">微信 App ID</label>
        <input class="input" type="text" name="wx_app_id" value="<?= \VoiceHubPay\Http\View::e($get('WX_APP_ID')) ?>" autocomplete="off">
      </div>
      <div class="field">
        <label class="label">微信 App Secret</label>
        <input class="input" type="text" name="wx_app_key" value="" placeholder="<?= \VoiceHubPay\Http\View::e($wx_key_placeholder) ?>" autocomplete="off">
        <div class="hint"><?= $wx_key_placeholder ? '已配置，留空表示不修改。' : 'AppSecret 加密存储。' ?></div>
      </div>
    </div>
    <div class="field">
      <label class="label">微信回调地址（在微信开放平台后台填写）</label>
      <div class="small"><code class="inline mono"><?= \VoiceHubPay\Http\View::e($wx_callback) ?></code></div>
    </div>

    <button class="btn btn-primary">保存登录设置</button>
  </form>
</div>
</div></div>
