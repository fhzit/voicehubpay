<?php /** @var array $settings @var string $private_key_placeholder @var string $public_key_placeholder @var string $notify_url @var string $return_url @var \VoiceHubPay\App $__app */
$__pageTitle = '支付设置';
$get = static fn (string $k, string $d = '') => (string) ($settings[$k] ?? $d);
$types = array_filter(explode(',', $get('SG65_ENABLED_TYPES', 'alipay,wxpay,qqpay')));
?>
<div class="settings-layout">
<div class="settings-nav">
  <span class="nav-group" style="padding:4px 12px 8px;">设置</span>
  <a href="/admin/settings/general">基础设置</a>
  <a href="/admin/settings/payment" class="active">支付设置</a>
  <a href="/admin/settings/auth">登录设置</a>
  <a href="/admin/settings/voicehub">VoiceHub 设置</a>
  <a href="/admin/settings/afdian">爱发电设置</a>
  <a href="/admin/settings/security">安全设置</a>
</div>
<div class="settings-column" style="min-width:0;">
<div class="settings-section" style="max-width:840px;">
  <h3 class="card-title mb-2">SG65 聚合支付（V2 · RSA SHA256WithRSA）</h3>
  <p class="muted small mb-4">仅支持 V2 签名（SHA256WithRSA），不支持 V1 MD5。密钥经主密钥加密保存，界面仅显示掩码。</p>

  <form method="post" action="/admin/settings/payment">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <div class="field checkbox-row">
      <input type="checkbox" name="sg65_enabled" id="sg65_enabled" value="1" <?= $get('SG65_ENABLED', '0') === '1' ? 'checked' : '' ?>>
      <label for="sg65_enabled" class="small muted">启用 SG65 支付</label>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">商户 PID</label>
        <input class="input" type="text" name="sg65_pid" required value="<?= \VoiceHubPay\Http\View::e($get('SG65_PID')) ?>">
      </div>
      <div class="field">
        <label class="label">默认支付方式</label>
        <select name="sg65_default_type" class="select">
          <?php foreach (['alipay' => '支付宝', 'wxpay' => '微信支付', 'qqpay' => 'QQ 钱包'] as $tk => $tl): ?>
            <option value="<?= $tk ?>" <?= $get('SG65_DEFAULT_PAYMENT_TYPE', 'alipay') === $tk ? 'selected' : '' ?>><?= $tl ?></option>
          <?php endforeach; ?>
        </select>
      </div>
    </div>
    <div class="field">
      <label class="label">启用支付方式</label>
      <div class="flex-wrap flex" style="gap:12px;">
        <?php foreach (['alipay' => '支付宝', 'wxpay' => '微信支付', 'qqpay' => 'QQ 钱包'] as $tk => $tl): ?>
          <div class="checkbox-row">
            <input type="checkbox" name="sg65_types[]" id="type_<?= $tk ?>" value="<?= $tk ?>" <?= in_array($tk, $types, true) ? 'checked' : '' ?>>
            <label for="type_<?= $tk ?>" class="small"><?= $tl ?></label>
          </div>
        <?php endforeach; ?>
      </div>
    </div>
    <div class="field">
      <label class="label">请求方式</label>
      <select name="sg65_default_method" class="select">
        <option value="jump" <?= $get('SG65_DEFAULT_METHOD', 'jump') === 'jump' ? 'selected' : '' ?>>跳转支付（生成支付地址跳转）</option>
        <option value="web" <?= $get('SG65_DEFAULT_METHOD', 'jump') === 'web' ? 'selected' : '' ?>>内嵌收银台（网页支付）</option>
      </select>
    </div>
    <div class="field">
      <label class="label">商户私钥（RSA 私钥 PEM）</label>
      <textarea class="textarea" name="sg65_merchant_private_key" rows="5" placeholder="<?= $private_key_configured ? '••••••••' : '-----BEGIN RSA PRIVATE KEY-----…' ?>"></textarea>
      <div class="hint"><?= $private_key_configured ? '当前已配置。留空或输入掩码表示不修改。' : '尚未配置，保存后加密存储。' ?></div>
    </div>
    <div class="field">
      <label class="label">平台公钥（SG65 平台 RSA 公钥 PEM）</label>
      <textarea class="textarea" name="sg65_platform_public_key" rows="5" placeholder="<?= $public_key_configured ? '••••••••' : '-----BEGIN PUBLIC KEY-----…' ?>"></textarea>
      <div class="hint">用于校验 SG65 通知签名。<?= $public_key_configured ? '当前已配置，留空表示不修改。' : '尚未配置。' ?></div>
    </div>

    <div class="field">
      <label class="label">回调地址（在 SG65 商户后台填写）</label>
      <div class="small"><code class="inline">异步通知：</code><code class="inline mono"><?= \VoiceHubPay\Http\View::e($notify_url) ?></code></div>
      <div class="small mt-1"><code class="inline">同步跳转：</code><code class="inline mono"><?= \VoiceHubPay\Http\View::e($return_url) ?></code></div>
    </div>

    <div class="flex">
      <button class="btn btn-primary">保存支付设置</button>
      <button class="btn btn-secondary" type="button" id="test-sg65">测试连接</button>
    </div>
  </form>
</div>

<script>
  document.getElementById('test-sg65').addEventListener('click', function () {
    var btn = this; btn.disabled = true; btn.textContent = '测试中…';
    var fd = new FormData(); fd.set('_csrf', VHP.csrf());
    fetch('/admin/settings/payment/test', { method: 'POST', credentials: 'same-origin', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) { VHP.toast(j.ok ? '连接成功：' + JSON.stringify(j.data) : '失败：' + j.error, j.ok ? 'success' : 'error'); btn.disabled = false; btn.textContent = '测试连接'; })
      .catch(function () { VHP.toast('网络错误', 'error'); btn.disabled = false; btn.textContent = '测试连接'; });
  });
</script>
</div></div>
