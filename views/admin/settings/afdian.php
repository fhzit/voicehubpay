<?php /** @var array $settings @var string $token_placeholder @var string $webhook_url @var ?string $last_webhook @var ?string $last_poll @var \VoiceHubPay\App $__app */
$__pageTitle = '爱发电设置';
$get = static fn (string $k, string $d = '') => (string) ($settings[$k] ?? $d);
?>
<div class="settings-layout settings-layout-single">
<div class="settings-column" style="min-width:0;">
<div class="settings-section" style="max-width:840px;">
  <h3 class="card-title mb-2">爱发电对接</h3>
  <p class="muted small mb-4">所有入口（Webhook / 轮询 / 后台同步 / 重试）统一经过 AfdianOrderProcessor，<strong>out_trade_no 始终作为 VoiceHub code</strong>，成功不重复推送。</p>

  <form method="post" action="/admin/settings/afdian">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <div class="field checkbox-row">
      <input type="checkbox" name="afdian_enabled" id="afdian_enabled" value="1" <?= $get('AFDIAN_ENABLED', '0') === '1' ? 'checked' : '' ?>>
      <label for="afdian_enabled" class="small muted">启用爱发电对接</label>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">爱发电 User ID</label>
        <input class="input" type="text" name="afdian_user_id" value="<?= \VoiceHubPay\Http\View::e($get('AFDIAN_USER_ID')) ?>">
      </div>
      <div class="field">
        <label class="label">API Token</label>
        <input class="input" type="text" name="afdian_api_token" value="" placeholder="<?= \VoiceHubPay\Http\View::e($token_placeholder) ?>" autocomplete="off">
        <div class="hint"><?= $token_placeholder ? '已配置，留空表示不修改。' : 'Token 加密存储。' ?></div>
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">API 地址</label>
        <input class="input" type="text" name="afdian_api_base" value="<?= \VoiceHubPay\Http\View::e($get('AFDIAN_API_BASE', 'https://ifdian.net')) ?>">
      </div>
      <div class="field">
        <label class="label">订单接口路径</label>
        <input class="input" type="text" name="afdian_order_endpoint" value="<?= \VoiceHubPay\Http\View::e($get('AFDIAN_ORDER_ENDPOINT', '/api/open/query-order')) ?>">
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">单次轮询订单上限</label>
        <input class="input" type="number" name="afdian_poll_limit" min="1" value="<?= (int) $get('AFDIAN_POLL_LIMIT', '20') ?>">
      </div>
      <div class="field">
        <label class="label">每页数量</label>
        <input class="input" type="number" name="afdian_poll_per_page" min="1" max="100" value="<?= (int) $get('AFDIAN_POLL_PER_PAGE', '50') ?>">
      </div>
    </div>
    <div class="field checkbox-row">
      <input type="checkbox" name="afdian_require_signature" id="afdian_require_signature" value="1" <?= $get('AFDIAN_WEBHOOK_REQUIRE_SIGNATURE', '1') === '1' ? 'checked' : '' ?>>
      <label for="afdian_require_signature" class="small muted">校验 Webhook 请求签名（RSA）</label>
    </div>
    <div class="field">
      <label class="label">Webhook 地址（在爱发电后台填写）</label>
      <div class="flex" style="gap:8px;">
        <code class="inline mono" id="afdian-webhook" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><?= \VoiceHubPay\Http\View::e($webhook_url) ?></code>
        <button class="btn btn-outline btn-sm" data-copy-target="#afdian-webhook" data-copy="__target" style="flex:none;">复制</button>
      </div>
      <div class="hint">最近 Webhook：<?= \VoiceHubPay\Http\View::datetime($last_webhook) ?> · 最近轮询：<?= \VoiceHubPay\Http\View::datetime($last_poll) ?></div>
    </div>
    <div class="flex">
      <button class="btn btn-primary">保存设置</button>
      <button class="btn btn-secondary" type="button" id="test-afdian">测试 API</button>
    </div>
  </form>
</div>

<script>
  document.getElementById('test-afdian').addEventListener('click', function () {
    var btn = this; btn.disabled = true; btn.textContent = '测试中…';
    var fd = new FormData(); fd.set('_csrf', VHP.csrf());
    fetch('/admin/settings/afdian/test', { method: 'POST', credentials: 'same-origin', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) { VHP.toast(j.ok ? '连接成功，返回 ' + j.orders_returned + ' 条订单' : '失败：' + j.error, j.ok ? 'success' : 'error'); btn.disabled = false; btn.textContent = '测试 API'; })
      .catch(function () { VHP.toast('网络错误', 'error'); btn.disabled = false; btn.textContent = '测试 API'; });
  });
</script>
</div></div>
