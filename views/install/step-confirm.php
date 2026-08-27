<?php /** @var array $state @var array $legacy @var \VoiceHubPay\App $__app @var ?array $__flash */
$db = $state['db'] ?? [];
$site = $state['site'] ?? [];
$admin = $state['admin'] ?? [];
$legacyConf = $state['legacy'] ?? [];
?>
<div class="steps" aria-label="安装进度">
  <?php for ($i = 1; $i <= 7; $i++): ?><div class="step <?= $i === 6 ? 'active' : ($i < 6 ? 'done' : '') ?>"><?= $i ?></div><?php endfor; ?>
</div>

<div class="install-card">
  <h2>第六步 · 确认安装</h2>
  <p class="ic-sub">请核对以下配置，点击“开始安装”后将执行数据库迁移与初始化</p>

  <?php if ($state['error'] ?? null): ?><div class="alert alert-error" style="margin-bottom:16px;"><?= \VoiceHubPay\Http\View::e($state['error']) ?></div><?php endif; ?>

  <div class="def-list" style="margin-bottom:6px;">
    <div class="def-row"><span class="def-k">数据库</span><span class="def-v"><?= strtoupper($db['connection'] ?? 'sqlite') ?> · <?= \VoiceHubPay\Http\View::e($db['database'] ?? '') ?></span></div>
    <div class="def-row"><span class="def-k">站点名称</span><span class="def-v"><?= \VoiceHubPay\Http\View::e($site['name'] ?? '') ?></span></div>
    <div class="def-row"><span class="def-k">站点 URL</span><span class="def-v"><?= \VoiceHubPay\Http\View::e($site['url'] ?? '') ?></span></div>
    <div class="def-row"><span class="def-k">时区</span><span class="def-v"><?= \VoiceHubPay\Http\View::e($site['timezone'] ?? '') ?></span></div>
    <div class="def-row"><span class="def-k">管理员</span><span class="def-v"><?= \VoiceHubPay\Http\View::e($admin['username'] ?? '') ?></span></div>
    <div class="def-row"><span class="def-k">旧数据迁移</span><span class="def-v"><?= !empty($legacyConf['detected']) ? '是（' . (int) ($legacyConf['count'] ?? 0) . ' 笔订单将安全迁移）' : '否（全新安装）' ?></span></div>
  </div>

  <div class="install-actions" style="justify-content:flex-end;">
    <a href="/install?step=5" class="btn btn-outline btn-lg">返回修改</a>
    <form method="post" action="/install?step=6" data-confirm="确定开始安装吗？安装过程中请勿关闭页面。">
      <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
      <input type="hidden" name="step" value="6">
      <button class="btn btn-primary btn-lg">开始安装</button>
    </form>
  </div>
</div>
