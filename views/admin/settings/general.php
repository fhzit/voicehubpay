<?php /** @var array $settings @var \VoiceHubPay\App $__app */
$__pageTitle = '基础设置';
$get = static fn (string $k, string $d = '') => (string) ($settings[$k] ?? $d);
?>
<div class="settings-layout settings-layout-single">
<div class="settings-column" style="min-width:0;">
<div class="settings-section" style="max-width:840px;">
  <h3 class="card-title mb-4">基础设置</h3>
  <form method="post" action="/admin/settings/general">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <div class="field">
      <label class="label">站点名称</label>
      <input class="input" type="text" name="site_name" required value="<?= \VoiceHubPay\Http\View::e($get('SITE_NAME', 'VoiceHubPay')) ?>">
    </div>
    <div class="field">
      <label class="label">站点 URL</label>
      <input class="input" type="text" name="site_url" required value="<?= \VoiceHubPay\Http\View::e($get('SITE_URL', $get('APP_URL', ''))) ?>">
      <div class="hint">支付回调与登录回调会基于此地址生成</div>
    </div>
    <div class="field">
      <label class="label">访客重定向地址（可选）</label>
      <input class="input" type="text" name="auth_redirect_url" value="<?= \VoiceHubPay\Http\View::e($get('AUTH_REDIRECT_URL')) ?>" placeholder="https://example.com">
      <div class="hint">设置后，未登录访客访问本站任意页面（除 /login、/register 与回调外）将 302 跳转到该地址，用于淡化本站的商业属性；留空则关闭此功能</div>
    </div>
    <div class="field">
      <label class="label">Logo URL（可选）</label>
      <input class="input" type="text" name="site_logo" value="<?= \VoiceHubPay\Http\View::e($get('SITE_LOGO')) ?>">
    </div>
    <div class="field">
      <label class="label">备案号（可选）</label>
      <input class="input" type="text" name="icp_beian_no" maxlength="64" value="<?= \VoiceHubPay\Http\View::e($get('ICP_BEIAN_NO')) ?>" placeholder="如：京ICP备12345678号-1">
      <div class="hint">填写后显示在网站底部并链接至工信部备案查询系统 beian.miit.gov.cn；留空则不显示</div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">时区</label>
        <select name="timezone" class="select">
          <?php foreach (['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Singapore', 'UTC', 'America/Los_Angeles', 'Europe/London'] as $tz): ?>
            <option value="<?= $tz ?>" <?= $get('APP_TIMEZONE', 'Asia/Shanghai') === $tz ? 'selected' : '' ?>><?= $tz ?></option>
          <?php endforeach; ?>
        </select>
      </div>
      <div class="field">
        <label class="label">未支付订单保留（分钟）</label>
        <input class="input" type="number" name="order_ttl" min="5" value="<?= (int) $get('ORDER_TTL_MINUTES', '30') ?>">
        <div class="hint">超时由 release-reservations.php 定时释放</div>
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <label class="label">分页大小</label>
        <input class="input" type="number" name="page_size" min="5" value="<?= (int) $get('PAGE_SIZE', '20') ?>">
      </div>
      <div class="field">
        <label class="label">开放注册</label>
        <div class="checkbox-row" style="margin-top:8px;">
          <input type="checkbox" name="registration" id="registration" value="1" <?= $get('REGISTRATION_ENABLED', '1') === '1' ? 'checked' : '' ?>>
          <label for="registration" class="small muted">允许访客注册账号</label>
        </div>
      </div>
    </div>
    <button class="btn btn-primary">保存设置</button>
  </form>
</div>
</div></div>
