<?php /** @var bool $has_password @var \VoiceHubPay\App $__app @var ?array $__user */ ?>
<?php $GLOBALS['__nav'] = 'profile'; ?>
<div class="page-head">
  <h1 class="page-title" style="font-size:26px;">账号资料</h1>
  <p class="page-sub">用户名与昵称是您在网站的身份标识，支持随时修改</p>
</div>

<?php if (!$has_password): ?>
  <div class="alert alert-warning" style="max-width:640px;margin-bottom:18px;">
    您当前是通过第三方（QQ / 微信）登录的账号，尚未设置用户名和密码。设置后即可用用户名 + 密码登录，<strong>第三方登录仅作为辅助</strong>。
  </div>
<?php endif; ?>

<form method="post" action="/account/profile" class="card" style="max-width:640px;padding:24px;">
  <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
  <div class="field">
    <label class="label" for="username">用户名</label>
    <input class="input" type="text" id="username" name="username" value="<?= \VoiceHubPay\Http\View::e($__user['username']) ?>" minlength="3" maxlength="32" autocomplete="username">
    <div class="hint">3-32 位字母、数字、下划线、短横线或中文；留空表示保持当前用户名</div>
  </div>
  <div class="field">
    <label class="label" for="display_name">昵称</label>
    <input class="input" type="text" id="display_name" name="display_name" value="<?= \VoiceHubPay\Http\View::e($__user['display_name'] ?: $__user['username']) ?>" maxlength="50">
    <div class="hint">昵称会展示在网页顶部与各处，最长 50 个字符</div>
  </div>
  <div class="field">
    <label class="label" for="email">邮箱（可选，用于接收支付/发货通知）</label>
    <input class="input" type="email" id="email" name="email" value="<?= \VoiceHubPay\Http\View::e($__user['email'] ?? '') ?>" maxlength="254" autocomplete="email">
    <div class="hint">支付成功、权益已发放等通知会发送到该邮箱；留空则不发送买家邮件</div>
  </div>
  <div class="sec-actions" style="margin-top:6px;"><button class="btn btn-primary">保存</button></div>
</form>

<?php if (!$has_password): ?>
  <div class="card" style="max-width:640px;margin-top:20px;padding:0;overflow:hidden;">
    <div style="padding:24px;border-bottom:1px solid var(--border);">
      <h3 style="margin:0 0 4px;">设置登录密码</h3>
      <p class="sec-desc" style="margin:0;">为您的账号设置密码，之后即可使用用户名 + 密码登录</p>
    </div>
    <form method="post" action="/account/complete" style="padding:24px;">
      <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
      <div class="field">
        <label class="label" for="compl-username">用户名（填写后作为账号密码登录的用户名）</label>
        <input class="input" type="text" id="compl-username" name="username" value="<?= \VoiceHubPay\Http\View::e($__user['username']) ?>" required minlength="3" maxlength="32" autocomplete="username">
      </div>
      <div class="form-grid">
        <div class="field">
          <label class="label" for="complete-password">密码</label>
          <input class="input" type="password" id="complete-password" name="password" required minlength="8" autocomplete="new-password">
          <div class="hint">至少 8 位</div>
        </div>
        <div class="field">
          <label class="label" for="complete-password-confirm">确认密码</label>
          <input class="input" type="password" id="complete-password-confirm" name="password_confirm" required minlength="8" autocomplete="new-password">
        </div>
      </div>
      <div class="sec-actions" style="margin-top:6px;"><button class="btn btn-primary">设置用户名和密码</button></div>
    </form>
  </div>
<?php else: ?>
  <div class="card" style="max-width:640px;margin-top:20px;">
    <div class="flex-between flex-wrap" style="gap:12px;">
      <div>
        <h3 style="margin:0 0 4px;">登录密码</h3>
        <p class="sec-desc" style="margin:0;">已设置密码，可使用用户名 + 密码登录</p>
      </div>
      <a href="/account/security" class="btn btn-secondary btn-sm">修改密码</a>
    </div>
  </div>
<?php endif; ?>