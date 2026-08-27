<?php /** @var array $settings @var string $aggregate_key_placeholder @var string $qq_callback @var string $wx_callback @var \VoiceHubPay\App $__app */
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

    <div class="notice notice-blue" style="margin-bottom:18px;">
      QQ 与微信均通过 <strong>任性聚合登录</strong> 接入，共用一套 AppID/AppKey。请先在
      <a href="https://a.idcfx.net/" target="_blank" rel="noopener noreferrer">a.idcfx.net</a>
      创建应用；<a href="https://a.idcfx.net/doc.php" target="_blank" rel="noopener noreferrer">查看官方开发文档</a>。
    </div>

    <div class="form-grid">
      <div class="field">
        <label class="label">聚合登录 AppID</label>
        <input class="input" type="text" name="aggregate_app_id" value="<?= \VoiceHubPay\Http\View::e($get('AGGREGATE_OAUTH_APP_ID')) ?>" autocomplete="off">
      </div>
      <div class="field">
        <label class="label">聚合登录 AppKey</label>
        <input class="input" type="password" name="aggregate_app_key" value="" placeholder="<?= \VoiceHubPay\Http\View::e($aggregate_key_placeholder) ?>" autocomplete="new-password">
        <div class="hint"><?= $aggregate_key_placeholder ? '已加密配置，留空表示不修改。' : 'AppKey 将使用主密钥加密存储。' ?></div>
      </div>
    </div>
    <div class="field">
      <label class="label">聚合登录接口地址</label>
      <input class="input" type="url" name="aggregate_endpoint" value="<?= \VoiceHubPay\Http\View::e($get('AGGREGATE_OAUTH_ENDPOINT', 'https://a.idcfx.net/connect.php')) ?>" autocomplete="off">
      <div class="hint">默认使用 https://a.idcfx.net/connect.php；只允许 HTTPS 地址。</div>
    </div>

    <hr style="border:none;border-top:1px solid var(--border);margin:20px 0;">

    <div class="field checkbox-row">
      <input type="checkbox" name="qq_enabled" id="qq_enabled" value="1" <?= $get('QQ_LOGIN_ENABLED', '0') === '1' ? 'checked' : '' ?>>
      <label for="qq_enabled" class="small muted"><strong>启用 QQ 登录</strong>（任性聚合登录 type=qq）</label>
    </div>
    <div class="field">
      <label class="label">QQ 回调地址</label>
      <div class="small"><code class="inline mono"><?= \VoiceHubPay\Http\View::e($qq_callback) ?></code></div>
      <div class="hint">聚合平台会在实际授权时自动使用该回调地址，并附带一次性 state。</div>
    </div>

    <hr style="border:none;border-top:1px solid var(--border);margin:20px 0;">

    <div class="field checkbox-row">
      <input type="checkbox" name="wx_enabled" id="wx_enabled" value="1" <?= $get('WX_LOGIN_ENABLED', '0') === '1' ? 'checked' : '' ?>>
      <label for="wx_enabled" class="small muted"><strong>启用微信登录</strong>（任性聚合登录 type=wx）</label>
    </div>
    <div class="field">
      <label class="label">微信回调地址</label>
      <div class="small"><code class="inline mono"><?= \VoiceHubPay\Http\View::e($wx_callback) ?></code></div>
      <div class="hint">QQ 和微信共用上方聚合登录 AppID/AppKey，不再配置 QQ 互联或微信开放平台密钥。</div>
    </div>

    <button class="btn btn-primary">保存登录设置</button>
  </form>
</div>
</div></div>
