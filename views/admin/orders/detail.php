<?php
/** @var array $order @var ?array $user @var array $payments @var array $unit_stats @var array $units @var array $recent_audit @var int $inventory_available @var \VoiceHubPay\App $__app */
$__pageTitle = '订单 ' . $order['order_no'];
$modeLabels = ['card' => '库存卡密', 'voicehub' => 'VoiceHub 发券', 'card_and_voicehub' => '卡密+发券', 'manual' => '人工发货'];
$item = $order['items'][0] ?? [];
$csrff = \VoiceHubPay\Security\Csrf::field();
?>
<div class="filters">
  <a href="/admin/orders" class="btn btn-ghost btn-sm">← 返回列表</a>
  <span class="muted mono"><?= \VoiceHubPay\Http\View::e($order['order_no']) ?></span>
  <?= $__app->view->partial('partials/status-badge', ['kind' => 'payment', 'status' => $order['payment_status']]) ?>
  <?= $__app->view->partial('partials/status-badge', ['kind' => 'fulfillment', 'status' => $order['fulfillment_status']]) ?>
  <span class="badge badge-<?= $order['source'] === 'afdian' ? 'purple' : 'blue' ?>"><?= $order['source'] === 'afdian' ? '爱发电' : '商城' ?></span>
  <div class="flex-1"></div>
  <?php if ($order['payment_status'] !== 'paid'): ?>
    <button class="btn btn-danger btn-sm" data-modal-open="modal-cancel">取消订单</button>
  <?php endif; ?>
  <button class="btn btn-primary btn-sm" data-modal-open="modal-manual">手动处理</button>
</div>

<div class="grid" style="grid-template-columns:1fr 340px;align-items:start;">
  <div>
    <div class="card">
      <div class="card-header"><h3 class="card-title">发货单元</h3>
        <div class="flex" style="gap:6px;flex-wrap:wrap;">
          <?php if ($order['payment_status'] === 'paid'): ?>
            <button class="btn btn-secondary btn-sm" data-modal-open="modal-process">处理待发货</button>
            <button class="btn btn-secondary btn-sm" data-modal-open="modal-retry">重试失败</button>
            <button class="btn btn-purple btn-sm" data-modal-open="modal-complete">整体人工完成</button>
          <?php endif; ?>
        </div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>单元</th><th>状态</th><th>VoiceHub</th><th>卡密（掩码）</th><th>错误</th><th class="text-right">操作</th></tr></thead>
        <tbody>
        <?php foreach ($units as $u): ?>
          <tr>
            <td class="mono small"><?= \VoiceHubPay\Http\View::e($u['unit']['unit_no']) ?></td>
            <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'fulfillment', 'status' => $u['unit']['status']]) ?></td>
            <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'voicehub', 'status' => $u['unit']['voicehub_status']]) ?></td>
            <td class="mono small"><?= \VoiceHubPay\Http\View::e($u['code_masked'] ?: '—') ?></td>
            <td class="small" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="<?= \VoiceHubPay\Http\View::e($u['unit']['last_error'] ?? '') ?>"><?= \VoiceHubPay\Http\View::e($u['unit']['last_error'] ?? '') ?></td>
            <td class="text-right">
              <?php if ($u['unit']['voicehub_status'] !== 'success' && $order['payment_status'] === 'paid'): ?>
                <button class="btn btn-ghost btn-sm" data-modal-open="modal-retry-unit" data-unit-id="<?= (int) $u['unit']['id'] ?>" data-unit-no="<?= \VoiceHubPay\Http\View::e($u['unit']['unit_no']) ?>">重试</button>
              <?php endif; ?>
              <?php if (in_array($u['unit']['status'], ['failed', 'pending', 'processing', 'manual_review'], true)): ?>
                <button class="btn btn-ghost btn-sm" data-modal-open="modal-assign" data-unit-id="<?= (int) $u['unit']['id'] ?>">分配</button>
                <button class="btn btn-ghost btn-sm" data-modal-open="modal-unit-complete" data-unit-id="<?= (int) $u['unit']['id'] ?>">标记完成</button>
              <?php endif; ?>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table></div>
    </div>

    <div class="card">
      <h3 class="card-title mb-3">订单信息</h3>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px 20px;">
        <div class="summary-row"><span class="muted">用户</span><span><?= \VoiceHubPay\Http\View::e($user['username'] ?? '—') ?><?= $user ? ' <a class="small" href="/admin/users/' . (int) $user['id'] . '">详情</a>' : '' ?></span></div>
        <div class="summary-row"><span class="muted">商品</span><span><?= \VoiceHubPay\Http\View::e($item['product_name_snapshot'] ?? '') ?> × <?= (int) ($item['quantity'] ?? 0) ?></span></div>
        <div class="summary-row"><span class="muted">单价快照</span><span>¥<?= \VoiceHubPay\Http\View::money((int) ($item['product_price_cents_snapshot'] ?? 0)) ?></span></div>
        <div class="summary-row"><span class="muted">发货方式</span><span><?= \VoiceHubPay\Http\View::e($modeLabels[$item['delivery_mode_snapshot'] ?? ''] ?? '—') ?></span></div>
        <div class="summary-row"><span class="muted">应付</span><span>¥<?= \VoiceHubPay\Http\View::money((int) $order['amount_due_cents']) ?></span></div>
        <div class="summary-row"><span class="muted">实付</span><span>¥<?= \VoiceHubPay\Http\View::money((int) $order['amount_paid_cents']) ?></span></div>
        <div class="summary-row"><span class="muted">创建时间</span><span class="small"><?= \VoiceHubPay\Http\View::datetime($order['created_at']) ?></span></div>
        <div class="summary-row"><span class="muted">支付时间</span><span class="small"><?= \VoiceHubPay\Http\View::datetime($order['paid_at']) ?></span></div>
      </div>
      <?php if ($order['payment_status'] === 'paid' && !empty($item['delivery_mode_snapshot']) && in_array($item['delivery_mode_snapshot'], ['card', 'card_and_voicehub'], true)): ?>
        <div class="hint mt-3">当前商品可售库存：<strong><?= $inventory_available ?></strong> 张 <a href="/admin/inventory?product=<?= (int) $item['product_id'] ?>">查看库存 →</a></div>
      <?php endif; ?>
    </div>

    <?php if ($payments !== []): ?>
      <div class="card">
        <h3 class="card-title mb-3">支付流水</h3>
        <?php foreach ($payments as $pt): ?>
          <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border);">
            <div>
              <span class="badge badge-blue"><?= \VoiceHubPay\Http\View::e($pt['pay_type']) ?></span>
              <span class="small muted ml-2 mono"><?= \VoiceHubPay\Http\View::e($pt['merchant_order_no'] ?? '') ?></span>
            </div>
            <div class="flex" style="gap:10px;">
              <span class="small">¥<?= \VoiceHubPay\Http\View::money((int) $pt['amount_cents']) ?></span>
              <?= $__app->view->partial('partials/status-badge', ['kind' => 'payment', 'status' => $pt['status']]) ?>
            </div>
          </div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <div class="card">
      <h3 class="card-title mb-3">相关操作日志</h3>
      <?php if ($recent_audit === []): ?><div class="muted small">暂无日志</div><?php endif; ?>
      <?php foreach ($recent_audit as $log): ?>
        <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border);">
          <div class="small"><code class="inline"><?= \VoiceHubPay\Http\View::e($log['action']) ?></code> <span class="muted"><?= \VoiceHubPay\Http\View::e($log['username'] ?? '') ?></span></div>
          <div class="small muted"><?= \VoiceHubPay\Http\View::datetime($log['created_at']) ?></div>
        </div>
      <?php endforeach; ?>
    </div>
  </div>

  <div>
    <div class="card">
      <h3 class="card-title mb-3">手动处理</h3>
      <div class="grid" style="gap:8px;">
        <button class="btn btn-secondary btn-block" data-modal-open="modal-query">查询 SG65 支付状态</button>
        <button class="btn btn-danger btn-block" data-modal-open="modal-manual-confirm" <?= $order['payment_status'] === 'paid' ? 'disabled' : '' ?>>人工确认付款（需密码）</button>
        <?php if ($order['payment_status'] === 'paid'): ?>
          <button class="btn btn-secondary btn-block" data-modal-open="modal-assign-inv" <?= $inventory_available <= 0 ? 'disabled' : '' ?>>为缺失单元分配库存</button>
        <?php endif; ?>
        <button class="btn btn-ghost btn-block" data-modal-open="modal-delete-unpaid" <?= $order['payment_status'] === 'paid' ? 'disabled' : '' ?>>取消未付款订单</button>
      </div>
      <div class="hint mt-3">高风险操作需要填写原因并写入操作日志；人工确认付款需验证管理员密码。</div>
    </div>

    <div class="card">
      <h3 class="card-title mb-3">VoiceHub 最近推送</h3>
      <?php $vhCount = 0; foreach ($units as $u) { if ($u['delivery']) { $vhCount++; } } ?>
      <?php if ($vhCount === 0): ?><div class="muted small">暂无推送记录</div><?php endif; ?>
      <?php foreach ($units as $u): ?>
        <?php if (!$u['delivery']) { continue; } ?>
        <div class="small" style="padding:6px 0;border-bottom:1px solid var(--border);">
          <div class="flex-between"><span class="mono"><?= \VoiceHubPay\Http\View::e($u['delivery']['source_order_no']) ?></span><?= $__app->view->partial('partials/status-badge', ['kind' => 'delivery', 'status' => $u['delivery']['status']]) ?></div>
          <div class="muted mt-1">码：<?= \VoiceHubPay\Http\View::e($u['delivery_masked']) ?> · 尝试 <?= (int) $u['delivery']['attempts'] ?> 次</div>
          <?php if ($u['delivery']['last_error']): ?><div class="small" style="color:var(--red);"><?= \VoiceHubPay\Http\View::e($u['delivery']['last_error']) ?></div><?php endif; ?>
        </div>
      <?php endforeach; ?>
    </div>
  </div>
</div>

<?php
// ---------- modal helpers ----------
$modal = static function (string $id, string $title, string $body, bool $lg = false): string {
    return '<div class="modal-backdrop" id="' . $id . '"><div class="modal' . ($lg ? ' modal-lg' : '') . '">'
        . '<div class="modal-header"><h3 class="modal-title">' . $title . '</h3><button class="modal-close" data-modal-close>×</button></div>'
        . $body
        . '</div></div>';
};
$modalForm = static function (string $id, string $title, string $action, array $fields, string $submitLabel = '确认', string $extraNote = '', string $variant = 'primary'): string {
    $h = '<input type="hidden" name="_csrf" value="' . \VoiceHubPay\Security\Csrf::token() . '">';
    foreach ($fields as $f) {
        $name = $f['name'] ?? '';
        $type = $f['type'] ?? 'text';
        $label = $f['label'] ?? '';
        $required = $f['required'] ?? false;
        $value = $f['value'] ?? '';
        $placeholder = $f['placeholder'] ?? '';
        $rows = $f['rows'] ?? null;
        $h .= '<div class="field"><label class="label">' . $label . ($required ? ' *' : '') . '</label>';
        if ($type === 'textarea') {
            $h .= '<textarea class="textarea" name="' . $name . '" rows="' . (int) ($rows ?? 3) . '" ' . ($required ? 'required' : '') . ' placeholder="' . $placeholder . '">' . $value . '</textarea>';
        } else {
            $h .= '<input class="input" type="' . $type . '" name="' . $name . '" value="' . $value . '" ' . ($required ? 'required' : '') . ' placeholder="' . $placeholder . '"' . ($type === 'password' ? ' autocomplete="new-password"' : '') . '>';
        }
        $h .= '</div>';
    }
    $alert = $variant === 'danger'
        ? '<div class="alert alert-warning" style="margin:16px 22px 0;"><strong>危险操作</strong> —— 此操作将修改订单状态并记录审计日志，请确认原因后执行。</div>'
        : '';
    $btnCls = $variant === 'danger' ? 'btn-danger' : 'btn-primary';
    return '<div class="modal-backdrop" id="' . $id . '"><div class="modal">'
        . '<div class="modal-header"><h3 class="modal-title">' . $title . '</h3><button class="modal-close" data-modal-close>×</button></div>'
        . $alert
        . '<form method="post" action="' . $action . '">' . $h . '<div class="modal-actions"><button class="btn btn-secondary" type="button" data-modal-close>取消</button><button class="btn ' . $btnCls . '">' . $submitLabel . '</button></div></form>'
        . ($extraNote ? '<div class="hint">' . $extraNote . '</div>' : '')
        . '</div></div>';
};
echo $modalForm('modal-query', '查询 SG65 支付状态', '/admin/orders/query-payment', [
    ['name' => 'order_no', 'type' => 'hidden', 'value' => \VoiceHubPay\Http\View::e($order['order_no'])],
    ['name' => 'note', 'type' => 'textarea', 'label' => '说明（可选）', 'placeholder' => '主动查询支付平台当前状态'],
], '查询', '仅查询不产生任何修改；若平台返回已支付，将自动入账并发货。');
echo $modalForm('modal-manual-confirm', '人工确认付款', '/admin/orders/manual-confirm', [
    ['name' => 'order_no', 'type' => 'hidden', 'value' => \VoiceHubPay\Http\View::e($order['order_no'])],
    ['name' => 'reason', 'type' => 'textarea', 'label' => '处理原因', 'required' => true, 'placeholder' => '例如：用户已线下转账，凭证已核对'],
    ['name' => 'admin_password', 'type' => 'password', 'label' => '管理员密码（二次验证）', 'required' => true],
], '确认入账并开始发货', '将订单标记为已支付 ¥' . \VoiceHubPay\Http\View::money((int) $order['amount_due_cents']) . '，并触发自动发货。', 'danger');
echo $modalForm('modal-cancel', '取消订单', '/admin/orders/cancel', [
    ['name' => 'order_no', 'type' => 'hidden', 'value' => \VoiceHubPay\Http\View::e($order['order_no'])],
    ['name' => 'reason', 'type' => 'textarea', 'label' => '取消原因', 'required' => true, 'placeholder' => '例如：用户放弃支付'],
], '取消订单并释放库存', '', 'danger');
echo $modalForm('modal-process', '处理待发货', '/admin/orders/process', [
    ['name' => 'order_no', 'type' => 'hidden', 'value' => \VoiceHubPay\Http\View::e($order['order_no'])],
    ['name' => 'note', 'type' => 'textarea', 'label' => '说明（可选）', 'placeholder' => '对全部待发货单元逐个调用 VoiceHub'],
], '开始处理', '逐个单元调用 VoiceHub，每次一个 code，绝不批量。');
echo $modalForm('modal-retry', '重试失败单元', '/admin/orders/retry-failed', [
    ['name' => 'order_no', 'type' => 'hidden', 'value' => \VoiceHubPay\Http\View::e($order['order_no'])],
], '重试');
echo $modalForm('modal-complete', '整体标记人工完成', '/admin/orders/complete', [
    ['name' => 'order_no', 'type' => 'hidden', 'value' => \VoiceHubPay\Http\View::e($order['order_no'])],
    ['name' => 'reason', 'type' => 'textarea', 'label' => '处理原因', 'required' => true, 'placeholder' => '例如：全部线下发放完毕'],
], '确认完成', '', 'danger');
echo $modalForm('modal-assign-inv', '分配库存', '/admin/orders/assign-inventory', [
    ['name' => 'order_no', 'type' => 'hidden', 'value' => \VoiceHubPay\Http\View::e($order['order_no'])],
    ['name' => 'reason', 'type' => 'textarea', 'label' => '处理原因', 'required' => true, 'placeholder' => '例如：用户付款后库存卡密缺失，补发'],
], '分配并开始发货', '将从商品可售库存中取卡分配给缺失单元并触发发货。当前可售：' . $inventory_available . ' 张');
echo $modalForm('modal-delete-unpaid', '取消未付款订单', '/admin/orders/delete-unpaid', [
    ['name' => 'order_no', 'type' => 'hidden', 'value' => \VoiceHubPay\Http\View::e($order['order_no'])],
    ['name' => 'reason', 'type' => 'textarea', 'label' => '处理原因', 'required' => true, 'placeholder' => '例如：超时未支付'],
], '取消', '', 'danger');
echo $modalForm('modal-retry-unit', '重试该单元', '/admin/orders/retry-unit', [
    ['name' => 'unit_id', 'type' => 'hidden', 'id' => 'unit_id'],
    ['name' => 'order_no', 'type' => 'hidden', 'value' => \VoiceHubPay\Http\View::e($order['order_no'])],
    ['name' => 'reason', 'type' => 'textarea', 'label' => '强制重推原因（可选）', 'placeholder' => '仅强制重推需填写'],
    ['name' => 'force', 'type' => 'checkbox', 'label' => '强制重新推送（会重复调用 VoiceHub）', 'value' => '1'],
], '执行重试', '普通重试会复用原 code；若已成功过则需勾选强制重推。');
echo $modalForm('modal-unit-complete', '标记单元完成', '/admin/orders/unit-complete', [
    ['name' => 'unit_id', 'type' => 'hidden', 'id' => 'unit_id2'],
    ['name' => 'order_no', 'type' => 'hidden', 'value' => \VoiceHubPay\Http\View::e($order['order_no'])],
    ['name' => 'reason', 'type' => 'textarea', 'label' => '处理原因', 'required' => true, 'placeholder' => '例如：线下已交付'],
], '确认', '', 'danger');
echo $modalForm('modal-assign', '人工分配卡密', '/admin/orders/assign-code', [
    ['name' => 'unit_id', 'type' => 'hidden', 'id' => 'unit_id3'],
    ['name' => 'order_no', 'type' => 'hidden', 'value' => \VoiceHubPay\Http\View::e($order['order_no'])],
    ['name' => 'code', 'type' => 'textarea', 'label' => '卡密内容', 'required' => true, 'placeholder' => '输入要发给用户的卡密'],
    ['name' => 'reason', 'type' => 'textarea', 'label' => '处理原因', 'required' => true, 'placeholder' => '例如：线下手动发卡'],
], '保存卡密', '卡密将加密存储，仅以掩码展示。');
?>

<script>
  (function () {
    // Fill unit-scoped modals with the clicked unit id.
    document.querySelectorAll('[data-modal-open][data-unit-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-unit-id');
        var modal = document.getElementById(btn.getAttribute('data-modal-open'));
        if (!modal) return;
        ['unit_id', 'unit_id2', 'unit_id3'].forEach(function (n) {
          var el = modal.querySelector('input[name="' + n + '"]');
          if (el) el.value = id;
        });
        var reason = modal.querySelector('textarea[name="reason"]');
        if (reason && reason.getAttribute('placeholder') === '例如：线下已交付') { }
      });
    });
  })();
</script>
