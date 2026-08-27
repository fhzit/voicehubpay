<?php /** @var array $order @var array $enabled_types @var string $default_type @var bool $payment_enabled @var string $method @var \VoiceHubPay\App $__app @var ?array $__user */
$GLOBALS['__nav'] = 'account';
// 键必须与后端 Sg65Client::enabledPayTypes() 返回的标识一致（alipay/wxpay/qqpay）
$typeMeta = [
  'alipay' => ['支付宝', 'ic-alipay', '<path d="M16.34 12.1c-.96-.42-1.9-.74-2.81-.99 1.2-1.96 2.1-4.02 2.7-6.1h-4.1c.35 1.04-.4 1.55-1.36 1.55H5.3v2.04h4.98c.28 0 .55 0 .82-.02-.5 1.36-1.1 2.7-1.83 3.99-.5-.1-1-.16-1.5-.2-2.08-.16-3.95.22-5.34 1.1-1.38.87-1.7 1.98-1.5 2.68.2.7.93 1.28 2.1 1.45.96.13 2.2-.03 3.62-.66 1.35-.6 2.76-1.55 4.1-2.76.66.98 1.44 1.83 2.3 2.53l-1.53 1.73c-.55.63-1.13 1.25-1.74 1.85-.16.16-.32.3-.48.45-.7.67-1.16 1.32-1.32 2.06.2-.08.4-.17.6-.28 1.13-.63 1.95-1.7 2.86-2.92 1.09-1.47 2.04-3.1 2.84-4.87 1.06.14 2.2.22 3.4.22 1.5 0 2.94-.14 4.32-.42v-2.3c-1.5 0-3.02-.1-4.53-.26ZM8.6 14.14c-.74.5-1.56.88-2.4 1.14-.6.18-1.1.25-1.47.25-.22 0-.4-.02-.53-.06-.25-.07-.4-.2-.45-.4-.04-.18.04-.42.26-.66.5-.55 1.4-.85 2.53-.88.5-.01 1 .04 1.5.14l.56.47Z"/>'],
  'wxpay' => ['微信支付', 'ic-wechat', '<path d="M9.5 4C5.36 4 2 6.8 2 10.24c0 1.98 1.06 3.74 2.73 4.9l-.68 2.13 2.37-1.22c.76.21 1.57.33 2.42.33.22 0 .43-.01.64-.03a5.6 5.6 0 0 1-.28-1.78c0-3.18 3.13-5.75 7-5.75.35 0 .7.02 1.03.06C16.9 6.02 13.5 4 9.5 4Zm-2.6 3.6a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7Zm5.2 0a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7ZM22 14.2c0-2.76-2.8-5-6.25-5s-6.25 2.24-6.25 5 2.8 5 6.25 5c.65 0 1.28-.09 1.87-.25l1.97 1.02-.57-1.78A4.94 4.94 0 0 0 22 14.2Zm-8.6-1.75a.72.72 0 1 1 0 1.44.72.72 0 0 1 0-1.44Zm4.7 0a.72.72 0 1 1 0 1.44.72.72 0 0 1 0-1.44Z"/>'],
  'qqpay' => ['QQ 钱包', 'ic-qq', '<path d="M12 2C6.48 2 2 5.72 2 10.32c0 2.7 1.6 5.08 4.1 6.62-.2 1.12-.58 2.4-1.2 3.26 2.04-.72 3.56-1.94 4.44-2.93.83.16 1.72.25 2.66.25 5.52 0 10-3.72 10-8.32S17.52 2 12 2Zm-1.13 8.2c0 .7-.56 1.26-1.24 1.26-.68 0-1.24-.56-1.24-1.26V8.26c0-.7.56-1.26 1.24-1.26.68 0 1.24.56 1.24 1.26v1.94Zm4.74 0c0 .7-.56 1.26-1.24 1.26-.68 0-1.24-.56-1.24-1.26V8.26c0-.7.56-1.26 1.24-1.26.68 0 1.24.56 1.24 1.26v1.94Z"/>'],
  'unionpay' => ['银联', '', ''],
  'balance' => ['余额', '', ''],
];
$payTypes = array_values(array_filter($enabled_types, static fn ($t) => isset($typeMeta[$t])));
$item = $order['items'][0] ?? [];
?>
<div class="container" style="padding-top:32px;">
  <div class="page-head"><h1 class="page-title" style="font-size:24px;">确认订单</h1></div>

  <?php if (!$payment_enabled): ?>
    <div class="notice notice-red" style="margin-bottom:18px;">支付通道尚未配置，请联系管理员完成 SG65 支付设置后再购买。</div>
  <?php endif; ?>

  <div class="checkout-grid">
    <!-- 左：订单内容 -->
    <div style="min-width:0;">
      <div class="checkout-card">
        <h3 class="card-title mb-1">商品信息</h3>
        <div class="flex-between" style="padding:14px 0;border-bottom:1px solid var(--border);">
          <div>
            <div style="font-weight:650;font-size:15px;"><?= \VoiceHubPay\Http\View::e($item['product_name_snapshot'] ?? '') ?></div>
            <div class="small muted" style="margin-top:3px;">单价 <span class="mono">¥<?= \VoiceHubPay\Http\View::money((int) ($item['product_price_cents_snapshot'] ?? 0)) ?></span></div>
          </div>
          <span class="badge badge-gray">×<?= (int) ($item['quantity'] ?? 1) ?></span>
        </div>
        <div class="summary-row" style="padding:14px 0 0;font-size:13px;">
          <span>订单号</span><span class="mono"><?= \VoiceHubPay\Http\View::e($order['order_no']) ?></span>
        </div>
        <div class="hint" style="margin-top:6px;">请在 <?= (int) ($GLOBALS['order_ttl'] ?? 30) ?> 分钟内完成支付，超时未支付订单将自动取消并释放库存。</div>
      </div>

      <div class="checkout-card" style="margin-top:20px;">
        <h3 class="card-title mb-1">安全保障</h3>
        <p class="small muted" style="margin:0 0 4px;">由 SG65 聚合支付提供（RSA 签名，安全可靠）；卡密支付成功后加密保存。</p>
      </div>
    </div>

    <!-- 右：付款 Summary -->
    <div class="checkout-card pay-summary">
      <h3 class="card-title mb-3">选择支付方式</h3>
      <?php if ($payment_enabled && $payTypes !== []): ?>
        <form method="post" action="/orders/<?= \VoiceHubPay\Http\View::e($order['order_no']) ?>/pay">
          <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
          <input type="hidden" name="pay_type" id="pay_type" value="<?= \VoiceHubPay\Http\View::e($default_type ?: ($payTypes[0] ?? 'alipay')) ?>">
          <div class="pay-methods" role="radiogroup" aria-label="支付方式">
            <?php foreach ($payTypes as $t): ?>
              <?php [$label, $iconClass, $iconPath] = $typeMeta[$t]; ?>
              <div class="pay-method <?= $t === ($default_type ?: $payTypes[0]) ? 'active' : '' ?>" data-type="<?= \VoiceHubPay\Http\View::e($t) ?>" role="radio" aria-checked="<?= $t === ($default_type ?: $payTypes[0]) ? 'true' : 'false' ?>" tabindex="0">
                <span class="pm-radio" aria-hidden="true"></span>
                <?php if ($iconPath !== ''): ?><span class="pm-ico <?= $iconClass ?>" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="<?= $iconPath ?>"/></svg></span><?php else: ?><span class="pm-ico <?= $iconClass ?>" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/></svg></span><?php endif; ?>
                <span class="pm-label"><?= \VoiceHubPay\Http\View::e($label) ?></span>
              </div>
            <?php endforeach; ?>
          </div>
          <div class="ps-total" style="margin-top:22px;">
            <span class="pt-label">应付金额</span>
            <span class="pt-value">¥<?= \VoiceHubPay\Http\View::money((int) $order['amount_due_cents']) ?></span>
          </div>
          <button class="btn btn-primary btn-lg btn-block" style="height:48px;font-size:15px;">¥<?= \VoiceHubPay\Http\View::money((int) $order['amount_due_cents']) ?> 立即支付</button>
        </form>
      <?php else: ?>
        <div class="empty" style="padding:24px 0;"><div class="empty-title">暂无可用的支付方式</div></div>
      <?php endif; ?>
    </div>
  </div>
</div>
