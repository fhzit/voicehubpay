<?php /** @var bool $has_password @var ?string $session_created @var \VoiceHubPay\App $__app */
$GLOBALS['__nav'] = 'security';
?>
<div class="page-head">
  <h1 class="page-title" style="font-size:26px;">安全设置</h1>
  <p class="page-sub">修改密码与账户安全信息</p>
</div>

<div class="card" style="max-width:640px;padding:0;overflow:hidden;">
  <div class="settings-section" style="border:none;border-radius:0;padding:24px;">
    <h3>修改密码</h3>
    <p class="sec-desc">密码使用 Argon2id 安全加密存储</p>
    <form method="post" action="/account/security/password">
      <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
      <?php if ($has_password): ?>
        <div class="field">
          <label class="label" for="current_password">当前密码</label>
          <input class="input" type="password" id="current_password" name="current_password" required autocomplete="current-password">
        </div>
      <?php endif; ?>
      <div class="form-grid">
        <div class="field">
          <label class="label" for="new_password">新密码</label>
          <input class="input" type="password" id="new_password" name="new_password" required minlength="8" autocomplete="new-password">
          <div class="hint">至少 8 位，Argon2id 加密</div>
        </div>
        <div class="field">
          <label class="label" for="new_password_confirm">确认新密码</label>
          <input class="input" type="password" id="new_password_confirm" name="new_password_confirm" required minlength="8" autocomplete="new-password">
        </div>
      </div>
      <div class="sec-actions" style="margin-top:0;"><button class="btn btn-primary">保存新密码</button></div>
    </form>
  </div>

  <div style="border-top:1px solid var(--border);padding:24px;">
    <h3>会话</h3>
    <p class="sec-desc" style="margin:0 0 12px;">当前登录状态</p>
    <div class="small" style="color:var(--muted-foreground);">
      <?php if ($session_created): ?>本次登录会话创建于 <span class="mono"><?= \VoiceHubPay\Http\View::datetime($session_created) ?></span><?php else: ?>当前会话已登录<?php endif; ?>
    </div>
  </div>

  <div style="border-top:1px solid var(--border);padding:24px;">
    <h3>登录方式</h3>
    <p class="sec-desc" style="margin:0 0 12px;">可在「账号绑定」中管理 QQ / 微信登录</p>
    <a href="/account/connections" class="btn btn-outline btn-sm">管理绑定</a>
  </div>
</div>

<div class="card" style="max-width:640px;margin-top:20px;">
  <h3 class="card-title mb-3">安全提示</h3>
  <ul class="muted small" style="padding-left:18px;margin:0;line-height:2;">
    <li>请勿将卡密和登录密码透露给他人。</li>
    <li>本站不会通过任何方式向你索要密码。</li>
    <li>卡密为虚拟商品，一经发出不支持退款。</li>
  </ul>
</div>
