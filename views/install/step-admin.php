<?php /** @var array $state @var \VoiceHubPay\App $__app @var ?array $__flash */
$admin = $state['admin'] ?? [];
?>
<div class="steps" aria-label="安装进度">
  <?php for ($i = 1; $i <= 7; $i++): ?><div class="step <?= $i === 5 ? 'active' : ($i < 5 ? 'done' : '') ?>"><?= $i ?></div><?php endfor; ?>
</div>

<div class="install-card">
  <div class="flex" style="gap:10px;margin-bottom:6px;">
    <span class="status-ico" style="width:34px;height:34px;border-radius:var(--radius-md);background:var(--primary-soft);color:var(--primary);display:inline-flex;align-items:center;justify-content:center;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
    </span>
    <h2 style="margin:0;">第五步 · 管理员账号</h2>
  </div>
  <p class="ic-sub">创建系统管理员账号，请牢记此账号密码；安装完成后不会自动填充默认密码</p>

  <?php if ($state['error'] ?? null): ?><div class="alert alert-error" style="margin-bottom:16px;"><?= \VoiceHubPay\Http\View::e($state['error']) ?></div><?php endif; ?>

  <form method="post" action="/install?step=5">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <input type="hidden" name="step" value="5">
    <div class="form-grid">
      <div class="field">
        <label class="label">管理员用户名</label>
        <input class="input" type="text" name="admin_username" required minlength="3" maxlength="32" value="<?= \VoiceHubPay\Http\View::e($admin['username'] ?? '') ?>" autocomplete="username" placeholder="例如 admin">
      </div>
      <div class="field">
        <label class="label">昵称（可选）</label>
        <input class="input" type="text" name="admin_display_name" maxlength="50" value="<?= \VoiceHubPay\Http\View::e($admin['display_name'] ?? '') ?>">
      </div>
    </div>
    <div class="field">
      <label class="label">邮箱（可选）</label>
      <input class="input" type="email" name="admin_email" value="<?= \VoiceHubPay\Http\View::e($admin['email'] ?? '') ?>">
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">密码</label>
        <input class="input" type="password" name="admin_password" required minlength="8" autocomplete="new-password">
        <div class="hint">至少 8 位，Argon2id 加密存储</div>
      </div>
      <div class="field">
        <label class="label">确认密码</label>
        <input class="input" type="password" name="admin_password_confirm" required minlength="8" autocomplete="new-password">
      </div>
    </div>
    <div class="install-actions" style="justify-content:flex-end;">
      <button class="btn btn-primary btn-lg">下一步 · 确认安装</button>
    </div>
  </form>
</div>
