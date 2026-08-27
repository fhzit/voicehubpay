<?php /** @var ?array $order @var string $order_no @var \VoiceHubPay\App $__app */
$GLOBALS['__nav'] = 'account';
$paid = $order !== null && $order['payment_status'] === 'paid';
?>
<div class="container">
  <div class="pay-confirm text-center">
    <?php if ($paid): ?>
      <div class="status-ico success">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
      <h1>支付成功</h1>
      <p class="pc-sub">订单 <span class="mono"><?= \VoiceHubPay\Http\View::e($order['order_no']) ?></span> 已确认支付，正在为你发货，卡密会自动保存到你的账户。</p>
      <div class="card" style="text-align:left;margin-bottom:20px;">
        <div class="summary-row"><span>订单号</span><span class="mono"><?= \VoiceHubPay\Http\View::e($order['order_no']) ?></span></div>
        <div class="summary-row"><span>金额</span><span>¥<?= \VoiceHubPay\Http\View::money((int) $order['amount_paid_cents']) ?></span></div>
        <div class="summary-row"><span>支付方式</span><span><?= \VoiceHubPay\Http\View::e(strtoupper((string) ($order['last_pay_type'] ?? 'SG65'))) ?></span></div>
      </div>
      <div class="vert-steps" style="text-align:left;">
        <div class="vert-step done"><span class="vs-dot">✓</span><div><div class="vs-title">支付确认</div><div class="vs-sub">已收到支付平台确认</div></div></div>
        <div class="vert-step done"><span class="vs-dot">✓</span><div><div class="vs-title">生成卡券</div><div class="vs-sub">卡密已加密保存到你的账户</div></div></div>
        <div class="vert-step done"><span class="vs-dot">✓</span><div><div class="vs-title">VoiceHub 同步</div><div class="vs-sub">发券同步正在进行</div></div></div>
      </div>
      <div class="flex" style="justify-content:center;gap:12px;margin-top:26px;">
        <a href="/orders/<?= \VoiceHubPay\Http\View::e($order['order_no']) ?>" class="btn btn-primary">查看卡密</a>
        <a href="/account/orders" class="btn btn-outline">我的订单</a>
      </div>
    <?php else: ?>
      <div class="status-ico info">
        <span class="spinner" style="width:26px;height:26px;border-width:3px;"></span>
      </div>
      <h1>正在确认支付</h1>
      <p class="pc-sub">订单 <span class="mono"><?= \VoiceHubPay\Http\View::e($order_no) ?></span> 已提交，正在等待支付平台确认。请勿关闭本页面。</p>
      <div class="card" style="text-align:left;margin-bottom:8px;">
        <div class="summary-row"><span>订单号</span><span class="mono"><?= \VoiceHubPay\Http\View::e($order_no) ?></span></div>
        <div class="summary-row"><span>支付方式</span><span>SG65 聚合支付</span></div>
      </div>
      <div class="vert-steps" style="text-align:left;">
        <div class="vert-step current"><span class="vs-dot">1</span><div><div class="vs-title">支付确认</div><div class="vs-sub">等待支付平台回调确认</div></div></div>
        <div class="vert-step"><span class="vs-dot">2</span><div><div class="vs-title">生成卡券</div><div class="vs-sub">确认后自动生成并加密保存</div></div></div>
        <div class="vert-step"><span class="vs-dot">3</span><div><div class="vs-title">VoiceHub 同步</div><div class="vs-sub">逐码调用发券接口</div></div></div>
      </div>
      <div id="poll-timeout" style="display:none;" class="notice notice-blue" style="margin-top:18px;">
        确认时间较长，支付成功后可随时到 <a href="/account/orders">我的订单</a> 查看卡密，无需重复支付。
      </div>
      <a href="/orders/<?= \VoiceHubPay\Http\View::e($order_no) ?>" class="btn btn-outline" style="margin-top:22px;">前往订单详情</a>
    <?php endif; ?>
  </div>

  <?php if (!$paid && $order_no !== ''): ?>
    <div data-poll-pay="/api/orders/<?= \VoiceHubPay\Http\View::e($order_no) ?>/status" style="display:none;"></div>
    <script>document.addEventListener('DOMContentLoaded', function () {
      var el = document.querySelector('[data-poll-pay]');
      if (!el) { return; }
      var url = el.getAttribute('data-poll-pay');
      var attempts = 0;
      var timer = setInterval(function () {
        attempts++;
        fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.ok && (j.payment_status === 'paid' || j.order_status === 'completed')) {
              clearInterval(timer); window.location.href = '/orders/' + encodeURIComponent('<?= \VoiceHubPay\Http\View::e($order_no) ?>');
            } else if (attempts >= 80) {
              clearInterval(timer);
              var hint = document.getElementById('poll-timeout');
              if (hint) { hint.style.display = 'block'; }
            }
          })
          .catch(function () {});
      }, 3000);
    });</script>
  <?php endif; ?>
</div>
