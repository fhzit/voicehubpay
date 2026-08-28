<?php /** @var array $settings @var bool $master_key_configured @var bool $https @var string $session_name @var bool $csrf_enabled @var \VoiceHubPay\App $__app */
$__pageTitle = '安全设置';
$get = static fn (string $k, string $d = '') => (string) ($settings[$k] ?? $d);
?>
<div class="settings-layout settings-layout-single">
<div class="settings-column" style="min-width:0;">
<div class="settings-section" style="max-width:840px;">
  <h3 class="card-title mb-4">安全设置</h3>
  <form method="post" action="/admin/settings/security">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <div class="field checkbox-row">
      <input type="checkbox" name="force_https" id="force_https" value="1" <?= $get('SECURITY_FORCE_HTTPS', '0') === '1' ? 'checked' : '' ?>>
      <label for="force_https" class="small muted">强制 HTTPS（直连读取 HTTPS；反代部署需显式配置 APP_TRUST_PROXY=1 后才读取 X-Forwarded-Proto）</label>
    </div>
    <div class="field">
      <label class="label">管理员会话超时（分钟）</label>
      <input class="input" type="number" name="admin_session_minutes" min="10" value="<?= (int) $get('SECURITY_ADMIN_SESSION_MINUTES', '120') ?>">
    </div>
    <button class="btn btn-primary">保存设置</button>
  </form>
</div>

<div class="settings-section" style="max-width:840px;">
  <h3 class="card-title mb-3">安全状态</h3>
  <div class="summary-row"><span class="muted">主密钥（APP_MASTER_KEY）</span><span><?= $master_key_configured ? '<span class="badge badge-green">已配置</span>' : '<span class="badge badge-red">未配置</span>' ?></span></div>
  <div class="summary-row"><span class="muted">卡密加密</span><span><span class="badge badge-green">libsodium secretbox</span></span></div>
  <div class="summary-row"><span class="muted">密码哈希</span><span><span class="badge badge-green">Argon2id</span></span></div>
  <div class="summary-row"><span class="muted">CSRF 防护</span><span><?= $csrf_enabled ? '<span class="badge badge-green">已启用</span>' : '<span class="badge badge-red">未启用</span>' ?></span></div>
  <div class="summary-row"><span class="muted">当前访问协议</span><span><?= $https ? '<span class="badge badge-green">HTTPS</span>' : '<span class="badge badge-amber">HTTP（生产建议开启 HTTPS）</span>' ?></span></div>
  <div class="summary-row"><span class="muted">Session 名称</span><span class="mono small"><?= \VoiceHubPay\Http\View::e($session_name) ?></span></div>
  <div class="hint mt-3">登录后自动调用 session_regenerate_id(true)；登录失败按用户名+IP 限流（5 次/15 分钟）。</div>
</div>
</div></div>
