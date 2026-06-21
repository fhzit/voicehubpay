<?php if (empty($orders)): ?>
    <div class="empty">暂无订单。</div>
<?php else: ?>
<div class="table-wrap">
    <table>
        <thead><tr><th>订单号</th><th>用户</th><th>金额</th><th>爱发电状态</th><th>VoiceHub</th><th>错误</th><th>操作</th></tr></thead>
        <tbody>
        <?php foreach ($orders as $order): ?>
            <tr>
                <td><code><?= htmlspecialchars($order['order_no']) ?></code></td>
                <td><?= htmlspecialchars($order['buyer_name'] ?: $order['afdian_user_id']) ?></td>
                <td><?= htmlspecialchars((string) $order['amount']) ?></td>
                <td><span class="badge"><?= htmlspecialchars($order['status']) ?></span></td>
                <td><span class="pill <?= htmlspecialchars($order['voicehub_status']) ?>"><?= htmlspecialchars($order['voicehub_status']) ?></span></td>
                <td class="muted"><?= htmlspecialchars((string) ($order['last_error'] ?? '')) ?></td>
                <td><form method="post" action="/orders/retry"><input type="hidden" name="order_no" value="<?= htmlspecialchars($order['order_no']) ?>"><button class="secondary">重试</button></form></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
<?php endif; ?>
