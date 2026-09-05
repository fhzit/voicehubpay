<?php /** @var string $provider @var string $nickname @var string $avatar @var ?array $__flash @var \VoiceHubPay\App $__app @var array $__site */ ?>
<div class="auth-logo">
  <span class="brand-logo">V</span>
  <span style="font-size:15px;font-weight:700;color:var(--foreground);"><?= \VoiceHubPay\Http\View::e($__site['name'] ?? 'VoiceHubPay') ?></span>
</div>

<h1 class="auth-title">完善账号</h1>
<p class="auth-sub">您已通过<?= $provider === 'wx' ? '微信' : 'QQ' ?>授权登录，请设置用户名和密码以完成账号创建</p>

<?php if ($__flash !== null): ?>
  <div class="alert alert-<?= \VoiceHubPay\Http\View::e($__flash['type'] ?? 'success') ?>" style="margin-bottom:16px;"><?= \VoiceHubPay\Http\View::e($__flash['message'] ?? '') ?></div>
<?php endif; ?>

<form method="post" action="/complete-social" id="cs-form">
  <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
  <div class="field">
    <label class="label" for="cs-username">用户名</label>
    <input class="input" type="text" id="cs-username" name="username" required minlength="3" maxlength="32"
           autocomplete="username" value="<?= \VoiceHubPay\Http\View::e($nickname) ?>">
    <div class="hint">已默认填入您的<?= $provider === 'wx' ? '微信' : 'QQ' ?>昵称，可修改。3-32 位字母、数字、下划线、短横线或中文。</div>
  </div>
  <div class="field">
    <label class="label" for="cs-email">邮箱（可选，用于接收支付/发货通知）</label>
    <input class="input" type="email" id="cs-email" name="email" maxlength="254" autocomplete="email">
  </div>
  <div class="field">
    <label class="label" for="cs-password">密码</label>
    <input class="input" type="password" id="cs-password" name="password" required minlength="8" autocomplete="new-password">
    <div class="pw-checklist" id="cs-checklist">
      <span class="ck" data-req="len">至少 8 位字符</span>
      <span class="ck" data-req="letter">包含字母</span>
      <span class="ck" data-req="digit">包含数字</span>
    </div>
  </div>
  <div class="field">
    <label class="label" for="cs-password-confirm">确认密码</label>
    <input class="input" type="password" id="cs-password-confirm" name="password_confirm" required minlength="8" autocomplete="new-password">
  </div>
  <button class="btn btn-primary btn-lg btn-block">完成创建</button>
</form>

<div class="text-center small muted" style="margin-top:22px;">已有账号？<a href="/login">直接登录</a></div>

<script>
document.addEventListener('DOMContentLoaded', function () {
  var pw = document.getElementById('cs-password');
  if (!pw) { return; }
  var check = function () {
    var v = pw.value;
    document.querySelectorAll('#cs-checklist .ck').forEach(function (el) {
      var met = false;
      if (el.getAttribute('data-req') === 'len') { met = v.length >= 8; }
      else if (el.getAttribute('data-req') === 'letter') { met = /[A-Za-z]/.test(v); }
      else if (el.getAttribute('data-req') === 'digit') { met = /\d/.test(v); }
      el.classList.toggle('met', met);
    });
  };
  pw.addEventListener('input', check);
  var c1 = document.getElementById('cs-password');
  var c2 = document.getElementById('cs-password-confirm');
  var form = document.getElementById('cs-form');
  form.addEventListener('submit', function (e) {
    if (c1.value !== c2.value) { e.preventDefault(); alert('两次输入的密码不一致。'); return; }
  });
});
</script>