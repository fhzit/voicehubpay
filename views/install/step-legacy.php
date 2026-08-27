<?php /** @var array $state @var array $legacy @var \VoiceHubPay\App $__app @var ?array $__flash */ ?>
<div class="steps" aria-label="安装进度">
  <?php for ($i = 1; $i <= 7; $i++): ?><div class="step <?= $i === 3 ? 'active' : ($i < 3 ? 'done' : '') ?>"><?= $i ?></div><?php endfor; ?>
</div>

<div class="install-card">
  <h2>第三步 · 旧数据迁移</h2>
  <p class="ic-sub">检测旧版 VoiceHubPay（爱发电桥接）数据并安全升级，旧数据库不会被删除</p>

  <?php if ($state['error'] ?? null): ?><div class="alert alert-error" style="margin-bottom:16px;"><?= \VoiceHubPay\Http\View::e($state['error']) ?></div><?php endif; ?>

  <?php if (($legacy['detected'] ?? false) === false): ?>
    <div class="notice notice-blue" style="margin-bottom:18px;">未检测到旧版安装数据（或已迁移完成），将进行全新安装。</div>
  <?php else: ?>
    <div class="notice notice-blue" style="margin-bottom:18px;">
      <strong>检测到旧版数据</strong>（识别结构：<?= \VoiceHubPay\Http\View::e($legacy['adapter'] ?? '未知') ?>）—— 迁移前会自动备份，历史已成功的订单不会被重复推送。
    </div>

    <div class="metric-4">
      <div><div class="m-label">历史订单</div><div class="m-value"><?= (int) ($legacy['count'] ?? 0) ?></div></div>
      <div><div class="m-label">已成功发货</div><div class="m-value" style="color:var(--success);"><?= (int) ($legacy['voicehub']['success'] ?? 0) ?></div></div>
      <div><div class="m-label">发货失败</div><div class="m-value" style="color:var(--destructive);"><?= (int) ($legacy['voicehub']['failed'] ?? 0) ?></div></div>
      <div><div class="m-label">历史金额（分）</div><div class="m-value"><?= (int) ($legacy['amount_cents'] ?? 0) ?></div></div>
    </div>

    <div class="hint" style="margin-top:6px;">迁移将：① 备份旧设置与数据库到 storage/backups；② 订单号原样保留为 out_trade_no；③ 已成功订单标记 success 且<b>不会重复推送</b>；④ 失败订单保留错误信息供后台重试；⑤ 金额转为分存储。</div>

    <?php if ($legacy['adapter'] === 'UnknownLegacy'): ?>
      <div class="notice notice-red" style="margin-top:14px;">无法识别的旧数据库结构，已阻止迁移。请先联系技术支持，切勿手动改动数据库。</div>
    <?php endif; ?>
  <?php endif; ?>

  <div class="install-actions" style="justify-content:flex-end;">
    <?php if (($legacy['detected'] ?? false) && $legacy['adapter'] !== 'UnknownLegacy'): ?>
      <form method="post" action="/install?step=3">
        <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
        <input type="hidden" name="step" value="3">
        <input type="hidden" name="action" value="dry_run">
        <button class="btn btn-outline">预演（仅检测）</button>
      </form>
    <?php endif; ?>
    <form method="post" action="/install?step=3">
      <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
      <input type="hidden" name="step" value="3">
      <input type="hidden" name="action" value="continue">
      <button class="btn btn-primary btn-lg"><?= ($legacy['detected'] ?? false) ? '继续 · 迁移将在确认页执行' : '继续安装' ?></button>
    </form>
  </div>
</div>
