<?php
/** @var string $kind @var string $status */
$map = [
    'payment' => ['paid' => ['green', '已支付'], 'unpaid' => ['amber', '未支付'], 'pending' => ['blue', '待确认'], 'failed' => ['red', '失败'], 'cancelled' => ['gray', '已取消']],
    'fulfillment' => ['success' => ['green', '已发货'], 'manual_completed' => ['purple', '人工完成'], 'partial' => ['orange', '部分完成'], 'processing' => ['blue', '发货中'], 'pending' => ['amber', '待发货'], 'failed' => ['red', '发货失败'], 'manual_review' => ['orange', '待人工处理']],
    'order' => ['completed' => ['green', '已完成'], 'pending_payment' => ['amber', '待支付'], 'cancelled' => ['gray', '已取消'], 'manual_review' => ['orange', '待人工处理']],
    'delivery' => ['success' => ['green', '成功'], 'failed' => ['red', '失败'], 'processing' => ['blue', '处理中'], 'pending' => ['amber', '待处理'], 'not_required' => ['gray', '无需推送']],
    'voicehub' => ['success' => ['green', '成功'], 'failed' => ['red', '失败'], 'processing' => ['blue', '处理中'], 'pending' => ['amber', '待处理'], 'not_required' => ['gray', '—'], 'already_success' => ['green', '已成功']],
    'inventory' => ['available' => ['green', '可售'], 'reserved' => ['blue', '已占用'], 'sold' => ['gray', '已售'], 'disabled' => ['red', '停用']],
    'user' => ['active' => ['green', '正常'], 'disabled' => ['red', '已禁用']],
    'afdian' => ['paid' => ['green', '已支付'], 'unpaid' => ['amber', '未支付'], 'pending' => ['blue', '处理中'], 'failed' => ['red', '失败'], 'success' => ['green', '已发货']],
    'status' => ['active' => ['green', '上架'], 'draft' => ['gray', '草稿'], 'disabled' => ['red', '下架'], 'success' => ['green', '成功'], 'failed' => ['red', '失败']],
];
$key = $status ?? '';
$entry = $map[$kind][$key] ?? ['gray', $key === '' ? '—' : $key];
[$color, $label] = $entry;
?>
<span class="badge badge-<?= $color ?>"><?= \VoiceHubPay\Http\View::e($label) ?></span>
