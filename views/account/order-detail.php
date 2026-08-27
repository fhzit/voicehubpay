<?php
/** @var array $order @var array $units @var array $payments @var array $unit_stats @var \VoiceHubPay\App $__app @var ?array $__user */
$GLOBALS['__nav'] = 'orders';
$totalUnits = array_sum($unit_stats);
$isProcessing = $order['payment_status'] === 'paid' && !in_array($order['fulfillment_status'], ['success', 'manual_completed'], true);
$modeLabels = ['card' => '库存卡密', 'voicehub' => 'VoiceHub 发券', 'card_and_voicehub' => '卡密+发券', 'manual' => '人工发货'];
?>
<div class="container" style="padding-top:24px;">
  <nav class="small muted mb-3"><a href="/account/orders">我的服务</a> › <?= \VoiceHubPay\Http\View::e($order['order_no']) ?></nav>

  <div class="page-head flex-between flex-wrap">
    <div>
      <h1 class="page-title mono"><?= \VoiceHubPay\Http\View::e($order['order_no']) ?></h1>
      <p class="page-sub">
        <?= $__app->view->partial('partials/status-badge', ['kind' => 'payment', 'status' => $order['payment_status']]) ?>
        <?= $__app->view->partial('partials/status-badge', ['kind' => 'fulfillment', 'status' => $order['fulfillment_status']]) ?>
        <span class="small muted">下单于 <?= \VoiceHubPay\Http\View::datetime($order['created_at']) ?></span>
      </p>
    </div>
    <?php if ($order['payment_status'] === 'unpaid'): ?>
      <a href="/checkout/<?= \VoiceHubPay\Http\View::e($order['order_no']) ?>" class="btn btn-primary">去支付</a>
    <?php endif; ?>
  </div>

  <?php if ($isProcessing): ?>
    <div class="notice notice-blue mb-4" data-poll="/api/orders/<?= \VoiceHubPay\Http\View::e($order['order_no']) ?>/status">
      <strong>正在自动发货…</strong> 支付已确认，系统正在逐张为你发放卡密。请不要关闭此页面，完成后会自动刷新。
      <div class="mt-2 flex" style="gap:14px;flex-wrap:wrap;">
        <span>待处理 <span id="stat-pending"><?= (int) ($unit_stats['pending'] ?? 0) ?></span></span>
        <span>处理中 <span id="stat-processing"><?= (int) ($unit_stats['processing'] ?? 0) ?></span></span>
        <span>已成功 <span id="stat-success"><?= (int) ($unit_stats['success'] ?? 0) ?></span></span>
        <span id="poll-timeout" style="display:none;color:var(--red);font-weight:600;">等待时间较长，可稍后刷新页面查看，卡密会自动保存。</span>
      </div>
      <div class="progress-track mt-3"><div class="progress-fill" id="poll-progress" style="width:0%"></div></div>
    </div>
  <?php endif; ?>

  <div class="checkout-grid" style="grid-template-columns:1.2fr .8fr;">
    <div>
      <div class="card">
        <div class="card-header"><h3 class="card-title">卡密 / 发货明细</h3>
          <?php if ($order['payment_status'] === 'paid' && count($units) > 1 && $totalUnits > 0): ?>
            <button class="btn btn-secondary btn-sm" data-reveal-order="<?= \VoiceHubPay\Http\View::e($order['order_no']) ?>">全部展示</button>
          <?php endif; ?>
        </div>

        <?php if ($order['payment_status'] !== 'paid'): ?>
          <div class="empty" style="padding:32px;">
            <div class="empty-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <div class="empty-title">支付后可查看卡密</div>
            <div><a href="/checkout/<?= \VoiceHubPay\Http\View::e($order['order_no']) ?>" class="btn btn-primary btn-sm">去支付</a></div>
          </div>
        <?php else: ?>
          <div class="code-list">
            <?php foreach ($units as $u): ?>
              <div class="code-item">
                <div style="min-width:0;">
                  <div class="small muted mono"><?= \VoiceHubPay\Http\View::e($u['unit']['unit_no']) ?>
                    <?php if (!empty($u['unit']['voicehub_code_ciphertext'])): ?>· VoiceHub<?php endif; ?>
                  </div>
                  <div class="mono" id="code-box-<?= (int) $u['unit']['id'] ?>">
                    <?php if ($u['unit']['delivery_code_ciphertext'] !== null): ?>
                      <span id="mask-<?= (int) $u['unit']['id'] ?>"><?= \VoiceHubPay\Http\View::e($u['masked']) ?></span>
                    <?php elseif (in_array($u['unit']['status'], ['failed', 'manual_review'], true)): ?>
                      <span style="color:var(--red);font-size:13px;">发货失败，请联系客服处理</span>
                    <?php else: ?>
                      <span class="faint" style="font-size:13px;">发放中…</span>
                    <?php endif; ?>
                  </div>
                  <?php if ($u['unit']['voicehub_status']): ?>
                    <div class="mt-1"><?= $__app->view->partial('partials/status-badge', ['kind' => 'voicehub', 'status' => $u['unit']['voicehub_status']]) ?></div>
                  <?php endif; ?>
                </div>
                <div class="flex">
                  <?php if ($u['unit']['delivery_code_ciphertext'] !== null): ?>
                    <button class="btn btn-ghost btn-sm copy-btn" data-copy-target="#code-box-<?= (int) $u['unit']['id'] ?>" data-copy="__target">复制</button>
                    <button class="btn btn-primary btn-sm" data-reveal-unit="<?= (int) $u['unit']['id'] ?>">查看</button>
                  <?php endif; ?>
                </div>
              </div>
            <?php endforeach; ?>
            <?php if ($units === []): ?>
              <div class="empty"><div class="empty-title">暂无明细</div></div>
            <?php endif; ?>
          </div>
          <div class="hint mt-3">卡密仅在支付后展示，请妥善保存，请勿泄露给他人。</div>
        <?php endif; ?>
      </div>
    </div>

    <div>
      <div class="card">
        <h3 class="card-title mb-3">订单信息</h3>
        <div class="summary-row"><span class="muted">商品</span><span><?= \VoiceHubPay\Http\View::e($order['items'][0]['product_name_snapshot'] ?? '') ?></span></div>
        <div class="summary-row"><span class="muted">单价</span><span>¥<?= \VoiceHubPay\Http\View::money((int) ($order['items'][0]['product_price_cents_snapshot'] ?? 0)) ?></span></div>
        <div class="summary-row"><span class="muted">数量</span><span><?= (int) ($order['items'][0]['quantity'] ?? 0) ?></span></div>
        <div class="summary-row"><span class="muted">发货方式</span><span><?= \VoiceHubPay\Http\View::e($modeLabels[$order['items'][0]['delivery_mode_snapshot'] ?? ''] ?? '自动发货') ?></span></div>
        <div class="summary-row total"><span>应付金额</span><span style="color:var(--red);">¥<?= \VoiceHubPay\Http\View::money((int) $order['amount_due_cents']) ?></span></div>
        <?php if ($order['payment_status'] === 'paid'): ?>
          <div class="summary-row"><span class="muted">实付金额</span><span>¥<?= \VoiceHubPay\Http\View::money((int) $order['amount_paid_cents']) ?></span></div>
          <div class="summary-row"><span class="muted">支付时间</span><span class="small"><?= \VoiceHubPay\Http\View::datetime($order['paid_at']) ?></span></div>
        <?php endif; ?>
      </div>

      <?php if ($payments !== []): ?>
        <div class="card">
          <h3 class="card-title mb-3">支付流水</h3>
          <?php foreach ($payments as $pt): ?>
            <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border);">
              <div>
                <div class="small mono"><?= \VoiceHubPay\Http\View::e($pt['pay_type']) ?></div>
                <div class="small muted"><?= \VoiceHubPay\Http\View::datetime($pt['created_at']) ?></div>
              </div>
              <div class="text-right">
                <div class="small">¥<?= \VoiceHubPay\Http\View::money((int) $pt['amount_cents']) ?></div>
                <?= $__app->view->partial('partials/status-badge', ['kind' => 'payment', 'status' => $pt['status']]) ?>
              </div>
            </div>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </div>
  </div>
</div>
