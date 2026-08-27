<?php /** @var bool $registration_enabled @var ?array $__flash @var \VoiceHubPay\App $__app @var array $__site */ ?>
<div class="auth-logo">
  <span class="brand-logo">V</span>
  <span style="font-size:15px;font-weight:700;color:var(--foreground);"><?= \VoiceHubPay\Http\View::e($__site['name'] ?? 'VoiceHubPay') ?></span>
</div>

<h1 class="auth-title">创建账户</h1>
<p class="auth-sub">注册后即可购买数字商品，卡券永久保存</p>

<?php if ($__flash !== null): ?>
  <div class="alert alert-<?= \VoiceHubPay\Http\View::e($__flash['type'] ?? 'success') ?>" style="margin-bottom:16px;"><?= \VoiceHubPay\Http\View::e($__flash['message'] ?? '') ?></div>
<?php endif; ?>

<?php if (!$registration_enabled): ?>
  <div class="notice">当前未开放自助注册，请使用第三方登录或联系管理员。</div>
<?php else: ?>
  <form method="post" action="/auth/password/register" id="reg-form">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <div class="form-grid">
      <div class="field">
        <label class="label" for="username">用户名</label>
        <input class="input" type="text" id="username" name="username" required minlength="3" maxlength="32" autocomplete="username">
        <div class="hint">3-32 位字母、数字或下划线</div>
      </div>
      <div class="field">
        <label class="label" for="display_name">昵称（可选）</label>
        <input class="input" type="text" id="display_name" name="display_name" maxlength="50">
      </div>
    </div>
    <div class="field">
      <label class="label" for="reg-password">密码</label>
      <input class="input" type="password" id="reg-password" name="password" required minlength="8" autocomplete="new-password">
      <div class="pw-checklist" id="pw-checklist">
        <span class="ck" data-req="len">至少 8 位字符</span>
        <span class="ck" data-req="letter">包含字母</span>
        <span class="ck" data-req="digit">包含数字</span>
      </div>
    </div>
    <div class="field">
      <label class="label" for="password_confirm">确认密码</label>
      <input class="input" type="password" id="password_confirm" name="password_confirm" required minlength="8" autocomplete="new-password">
    </div>
    <div class="field checkbox-row">
      <input type="checkbox" name="agreed" id="agreed" value="1" required>
      <label for="agreed" class="small muted">我已阅读并同意《服务条款》，卡密为虚拟商品，购买后不退款</label>
    </div>
    <button class="btn btn-primary btn-lg btn-block">注 册</button>
  </form>
  <div class="text-center small muted" style="margin-top:22px;">已有账号？<a href="/login">直接登录</a></div>
<?php endif; ?>

<script>
document.addEventListener('DOMContentLoaded', function () {
  var pw = document.getElementById('reg-password');
  if (!pw) { return; }
  var check = function () {
    var v = pw.value;
    document.querySelectorAll('#pw-checklist .ck').forEach(function (el) {
      var met = false;
      if (el.getAttribute('data-req') === 'len') { met = v.length >= 8; }
      else if (el.getAttribute('data-req') === 'letter') { met = /[A-Za-z]/.test(v); }
      else if (el.getAttribute('data-req') === 'digit') { met = /\d/.test(v); }
      el.classList.toggle('met', met);
    });
  };
  pw.addEventListener('input', check);
  check();
});
</script>
