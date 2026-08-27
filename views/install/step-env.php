<?php
/** @var array $state @var array $env @var \VoiceHubPay\App $__app @var ?array $__flash */
$canContinue = !array_filter($env, static fn (array $check): bool => $check['required'] && !$check['ok']);
?>
<div class="steps" aria-label="安装进度">
  <?php for ($i = 1; $i <= 7; $i++): ?><div class="step <?= $i === 1 ? 'active' : '' ?>"><?= $i ?></div><?php endfor; ?>
</div>

<div class="install-card">
  <h2>第一步 · 环境检测</h2>
  <p class="ic-sub">检查运行环境是否满足要求（PHP 8.2+，原生 PHP，无需框架依赖）</p>

  <?php if ($state['error'] ?? null): ?><div class="alert alert-error" style="margin-bottom:16px;"><?= \VoiceHubPay\Http\View::e($state['error']) ?></div><?php endif; ?>

  <div class="env-list">
    <?php foreach ($env as $c): ?>
      <?php $cls = $c['required'] ? ($c['ok'] ? 'env-ok' : 'env-fail') : 'env-opt'; ?>
      <div class="env-row <?= $cls ?>">
        <span class="env-ico">
          <?php if (!$c['required']): ?><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>
          <?php elseif ($c['ok']): ?><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          <?php else: ?><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg><?php endif; ?>
        </span>
        <div style="min-width:0;">
          <div class="env-name"><?= \VoiceHubPay\Http\View::e($c['label']) ?> <?= $c['required'] ? '' : '<span class="badge badge-gray" style="margin-left:4px;">可选</span>' ?></div>
          <div class="env-desc"><?= \VoiceHubPay\Http\View::e($c['hint']) ?></div>
        </div>
        <span class="env-val"><?= $c['ok'] ? '通过' : ($c['required'] ? '未通过' : '未启用') ?></span>
      </div>
    <?php endforeach; ?>
  </div>

  <form method="post" action="/install?step=1" class="install-actions" style="justify-content:flex-end;">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <input type="hidden" name="step" value="1">
    <button class="btn btn-primary btn-lg" <?= $canContinue ? '' : 'disabled' ?>>下一步 · 数据库配置</button>
  </form>
</div>
