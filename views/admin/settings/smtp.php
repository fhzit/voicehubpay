<?php /** @var array $settings @var string $password_placeholder @var \VoiceHubPay\App $__app @var ?array $__flash */
$__pageTitle = '邮件设置';
$get = static fn (string $k, string $d = '') => (string) ($settings[$k] ?? $d);
?>
<div class="settings-layout settings-layout-single">
<div class="settings-column" style="min-width:0;">
<div class="settings-section" style="max-width:840px;">
  <h3 class="card-title mb-2">SMTP 发信</h3>
  <p class="muted small mb-4">配置后用于向你发送支付成功 / 发货成功通知，以及向管理员发送到账与异常告警。</p>

  <form method="post" action="/admin/settings/smtp">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <div class="field checkbox-row">
      <input type="checkbox" name="smtp_enabled" id="smtp_enabled" value="1" <?= $get('SMTP_ENABLED', '0') === '1' ? 'checked' : '' ?>>
      <label for="smtp_enabled" class="small muted">启用 SMTP 邮件通知</label>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">SMTP 服务器</label>
        <input class="input" type="text" name="smtp_host" value="<?= \VoiceHubPay\Http\View::e($get('SMTP_HOST')) ?>" placeholder="smtp.qq.com">
      </div>
      <div class="field">
        <label class="label">端口</label>
        <input class="input" type="number" name="smtp_port" value="<?= (int) $get('SMTP_PORT', '587') ?>">
      </div>
    </div>
    <div class="field">
      <label class="label">加密方式</label>
      <select name="smtp_encryption" class="select">
        <option value="tls" <?= $get('SMTP_ENCRYPTION', 'tls') === 'tls' ? 'selected' : '' ?>>STARTTLS（默认，587）</option>
        <option value="ssl" <?= $get('SMTP_ENCRYPTION') === 'ssl' ? 'selected' : '' ?>>SSL（隐式加密，465）</option>
        <option value="" <?= $get('SMTP_ENCRYPTION') === '' ? 'selected' : '' ?>>无加密（不安全）</option>
      </select>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">用户名</label>
        <input class="input" type="text" name="smtp_username" value="<?= \VoiceHubPay\Http\View::e($get('SMTP_USERNAME')) ?>" autocomplete="off">
      </div>
      <div class="field">
        <label class="label">密码 / 授权码</label>
        <input class="input" type="password" name="smtp_password" value="" placeholder="<?= \VoiceHubPay\Http\View::e($password_placeholder) ?>" autocomplete="new-password">
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">发件人邮箱（From）</label>
        <input class="input" type="email" name="smtp_from" value="<?= \VoiceHubPay\Http\View::e($get('SMTP_FROM')) ?>" placeholder="noreply@example.com">
      </div>
      <div class="field">
        <label class="label">发件人名称</label>
        <input class="input" type="text" name="smtp_from_name" value="<?= \VoiceHubPay\Http\View::e($get('SMTP_FROM_NAME', $get('SITE_NAME'))) ?>">
      </div>
    </div>
    <div class="field">
      <label class="label">管理员通知邮箱</label>
      <input class="input" type="email" name="notify_email" value="<?= \VoiceHubPay\Http\View::e($get('NOTIFY_EMAIL')) ?>" placeholder="admin@example.com">
      <div class="hint">支付到账、支付/发货异常等运营告警会发送到该邮箱（留空则只发买家邮件，不发告警）。</div>
    </div>
    <div class="flex">
      <button class="btn btn-primary">保存设置</button>
      <button class="btn btn-secondary" type="button" id="test-smtp">发送测试邮件</button>
    </div>
    <div class="hint" style="margin-top:8px;">「发送测试邮件」会向工单邮箱发送一封测试邮件以验证配置；需先保存配置。</div>
  </form>
</div>
</div></div>

<script>
  var t = document.getElementById('test-smtp');
  if (t) t.addEventListener('click', function () {
    var btn = this; btn.disabled = true; btn.textContent = '测试中…';
    var fd = new FormData(); fd.set('_csrf', VHP.csrf());
    fd.set('notify_email', document.querySelector('input[name=notify_email]').value);
    fetch('/admin/settings/smtp/test', { method: 'POST', credentials: 'same-origin', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) { VHP.toast(j.ok ? (j.note || '发送成功') : '失败：' + j.error, j.ok ? 'success' : 'error'); btn.disabled = false; btn.textContent = '发送测试邮件'; })
      .catch(function () { VHP.toast('网络错误', 'error'); btn.disabled = false; btn.textContent = '发送测试邮件'; });
  });
</script>
</div></div>