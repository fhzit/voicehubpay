<?php /** @var array $settings @var string $token_placeholder @var ?array $last_success @var ?array $last_failure @var array $stats @var \VoiceHubPay\App $__app */
$__pageTitle = 'VoiceHub 设置';
$get = static fn (string $k, string $d = '') => (string) ($settings[$k] ?? $d);
?>
<div class="settings-layout">
<div class="settings-nav">
  <span class="nav-group" style="padding:4px 12px 8px;">设置</span>
  <a href="/admin/settings/general">基础设置</a>
  <a href="/admin/settings/payment">支付设置</a>
  <a href="/admin/settings/auth">登录设置</a>
  <a href="/admin/settings/voicehub" class="active">VoiceHub 设置</a>
  <a href="/admin/settings/afdian">爱发电设置</a>
  <a href="/admin/settings/security">安全设置</a>
</div>
<div class="settings-column" style="min-width:0;">
<div class="settings-section" style="max-width:840px;">
  <h3 class="card-title mb-2">VoiceHub 发券接口</h3>
  <p class="muted small mb-4">商城订单与爱发电订单都会经由本接口逐码发券（每次一个 code，绝不批量）。</p>

  <form method="post" action="/admin/settings/voicehub">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <div class="field checkbox-row">
      <input type="checkbox" name="voicehub_enabled" id="voicehub_enabled" value="1" <?= $get('VOICEHUB_ENABLED', '0') === '1' ? 'checked' : '' ?>>
      <label for="voicehub_enabled" class="small muted">启用 VoiceHub 发券</label>
    </div>
    <div class="field">
      <label class="label">API Base URL</label>
      <input class="input" type="text" name="voicehub_api_base" value="<?= \VoiceHubPay\Http\View::e($get('VOICEHUB_API_BASE')) ?>" placeholder="https://your-voicehub.example.com">
    </div>
    <div class="field">
      <label class="label">发券接口路径</label>
      <input class="input" type="text" name="voicehub_ticket_endpoint" value="<?= \VoiceHubPay\Http\View::e($get('VOICEHUB_TICKET_ENDPOINT', '/api/open/card-codes')) ?>">
    </div>
    <div class="field">
      <label class="label">API Key（请求头 x-api-key）</label>
      <input class="input" type="text" name="voicehub_api_token" value="" placeholder="<?= \VoiceHubPay\Http\View::e($token_placeholder) ?>" autocomplete="off">
      <div class="hint"><?= $token_placeholder ? '已配置，留空表示不修改。' : 'Token 加密存储。' ?></div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">超时（秒）</label>
        <input class="input" type="number" name="voicehub_timeout" min="5" value="<?= (int) $get('VOICEHUB_TIMEOUT', '20') ?>">
      </div>
      <div class="field">
        <label class="label">重试次数</label>
        <input class="input" type="number" name="voicehub_retries" min="1" value="<?= (int) $get('VOICEHUB_RETRIES', '3') ?>">
      </div>
    </div>
    <div class="flex">
      <button class="btn btn-primary">保存设置</button>
      <button class="btn btn-secondary" type="button" id="test-voicehub">测试连通性</button>
    </div>
    <div class="hint" style="margin-top:8px;">「测试连通性」仅验证 Base URL 可达（HEAD 请求），<strong>不会发放任何正式券码</strong>。</div>
  </form>
</div>

<div class="settings-section" style="max-width:840px;">
  <h3 class="card-title mb-3">运行状态</h3>
  <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);">
    <div class="stat-card"><div class="stat-label">总请求</div><div class="stat-value"><?= (int) $stats['total'] ?></div></div>
    <div class="stat-card"><div class="stat-label">成功</div><div class="stat-value" style="color:var(--green);"><?= (int) $stats['success'] ?></div></div>
    <div class="stat-card"><div class="stat-label">失败</div><div class="stat-value" style="color:var(--red);"><?= (int) $stats['failed'] ?></div></div>
    <div class="stat-card"><div class="stat-label">今日</div><div class="stat-value"><?= (int) $stats['today'] ?></div></div>
  </div>
  <div class="summary-row mt-4"><span class="muted">最近成功</span><span class="small"><?= $last_success ? $last_success['source_order_no'] . ' · ' . \VoiceHubPay\Http\View::datetime($last_success['updated_at']) : '暂无' ?></span></div>
  <div class="summary-row"><span class="muted">最近失败</span><span class="small"><?= $last_failure ? $last_failure['source_order_no'] . ' · ' . \VoiceHubPay\Http\View::e($last_failure['last_error']) : '暂无' ?></span></div>
</div>

<script>
  document.getElementById('test-voicehub').addEventListener('click', function () {
    var btn = this; btn.disabled = true; btn.textContent = '测试中…';
    var fd = new FormData(); fd.set('_csrf', VHP.csrf());
    fetch('/admin/settings/voicehub/test', { method: 'POST', credentials: 'same-origin', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) { VHP.toast(j.ok ? (j.note || '连接成功') : '失败：' + j.error, j.ok ? 'success' : 'error'); btn.disabled = false; btn.textContent = '测试连通性'; })
      .catch(function () { VHP.toast('网络错误', 'error'); btn.disabled = false; btn.textContent = '测试连通性'; });
  });
</script>
</div></div>
