<?php /** @var array $state @var \VoiceHubPay\App $__app @var ?array $__flash */
$site = $state['site'] ?? [];
?>
<div class="steps" aria-label="安装进度">
  <?php for ($i = 1; $i <= 7; $i++): ?><div class="step <?= $i === 4 ? 'active' : ($i < 4 ? 'done' : '') ?>"><?= $i ?></div><?php endfor; ?>
</div>

<div class="install-card">
  <h2>第四步 · 网站配置</h2>
  <p class="ic-sub">站点名称、访问地址与时区</p>

  <?php if ($state['error'] ?? null): ?><div class="alert alert-error" style="margin-bottom:16px;"><?= \VoiceHubPay\Http\View::e($state['error']) ?></div><?php endif; ?>

  <form method="post" action="/install?step=4">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <input type="hidden" name="step" value="4">
    <div class="field">
      <label class="label">站点名称</label>
      <input class="input" type="text" name="site_name" required value="<?= \VoiceHubPay\Http\View::e($site['name'] ?? 'VoiceHubPay') ?>">
    </div>
    <div class="field">
      <label class="label">站点 URL</label>
      <input class="input" type="text" name="site_url" required value="<?= \VoiceHubPay\Http\View::e($site['url'] ?? '') ?>" placeholder="https://shop.example.com">
      <div class="hint">用于生成支付回调与登录回调地址，请填写公网可访问的完整地址</div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">时区</label>
        <select name="timezone" class="select">
          <?php foreach (['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Singapore', 'UTC', 'America/Los_Angeles', 'Europe/London'] as $tz): ?>
            <option value="<?= $tz ?>" <?= ($site['timezone'] ?? 'Asia/Shanghai') === $tz ? 'selected' : '' ?>><?= $tz ?></option>
          <?php endforeach; ?>
        </select>
      </div>
      <div class="field">
        <label class="label">未支付订单保留（分钟）</label>
        <input class="input" type="number" name="order_ttl" min="5" max="1440" value="<?= (int) ($site['order_ttl'] ?? 30) ?>">
      </div>
    </div>
    <div class="field checkbox-row">
      <input type="checkbox" name="registration" id="registration" value="1" <?= ($site['registration'] ?? '1') === '1' ? 'checked' : '' ?>>
      <label for="registration" class="small muted">开放自助注册（关闭后仅第三方登录或由管理员建号）</label>
    </div>
    <div class="install-actions" style="justify-content:flex-end;">
      <button class="btn btn-primary btn-lg">下一步 · 管理员账号</button>
    </div>
  </form>
</div>
