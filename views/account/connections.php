<?php /** @var array $connections @var bool $has_password @var bool $qq_enabled @var bool $wx_enabled @var \VoiceHubPay\App $__app @var ?array $__user */
$GLOBALS['__nav'] = 'connections';
?>
<div class="page-head">
  <h1 class="page-title" style="font-size:26px;">账号绑定</h1>
  <p class="page-sub">管理你的登录方式，至少需要保留一种</p>
</div>

<div class="card" style="max-width:640px;padding:0;overflow:hidden;">
  <div class="settings-section" style="border:none;border-radius:0;padding:22px;">
    <div class="flex-between">
      <div>
        <h3 style="margin:0 0 2px;">账号密码</h3>
        <p class="sec-desc" style="margin:0;">使用用户名 + 密码登录</p>
      </div>
      <a href="/account/security" class="btn btn-secondary btn-sm"><?= $has_password ? '修改' : '设置' ?></a>
    </div>
    <div style="margin-top:8px;"><?= $has_password ? '<span class="status-dot status-dot-success">已设置</span>' : '<span class="status-dot status-dot-muted">未设置密码</span>' ?></div>
  </div>

  <?php foreach (['qq' => ['QQ 登录', 'QQ'], 'wx' => ['微信登录', '微信']] as $provider => [$label, $short]): ?>
    <?php $conn = null; foreach ($connections as $c) { if ($c['provider'] === $provider) { $conn = $c; break; } } ?>
    <div style="border-top:1px solid var(--border);padding:22px;">
      <div class="flex-between flex-wrap" style="gap:12px;">
        <div class="flex" style="gap:14px;">
          <span class="pm-ico" style="width:40px;height:40px;font-size:14px;<?= $provider === 'qq' ? 'color:#12B7F5;' : 'color:#07C160;' ?>font-weight:800;"><?= $short ?></span>
          <div>
            <div style="font-weight:650;"><?= $label ?></div>
            <div class="small" style="margin-top:2px;">
              <?php if ($conn !== null): ?>
                <span class="status-dot status-dot-success">已绑定<?= \VoiceHubPay\Http\View::e($conn['nickname'] ? ' · ' . $conn['nickname'] : '') ?></span>
              <?php else: ?>
                <span class="status-dot status-dot-muted">未绑定</span>
              <?php endif; ?>
            </div>
          </div>
        </div>
        <div>
          <?php if ($conn !== null): ?>
            <form method="post" action="/account/connections/unbind" data-confirm="确定要解绑<?= $label ?>吗？解绑后将无法使用该方式登录。" data-confirm-danger data-confirm-title="解绑登录方式">
              <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
              <input type="hidden" name="provider" value="<?= $provider ?>">
              <button class="btn btn-ghost btn-sm">解绑</button>
            </form>
          <?php else: ?>
            <?php $enabled = $provider === 'qq' ? $qq_enabled : $wx_enabled; ?>
            <span class="small muted"><?= $enabled ? '可前往登录页绑定' : ($provider === 'qq' ? 'QQ 登录未开启' : '微信登录未开启') ?></span>
          <?php endif; ?>
        </div>
      </div>
    </div>
  <?php endforeach; ?>
</div>

<div class="hint" style="margin-top:14px;max-width:640px;">QQ / 微信为第三方授权登录，绑定不会合并昵称或头像；解绑需保留至少一种登录方式。</div>
