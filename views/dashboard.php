<section class="card">
    <h1>管理面板</h1>
    <p class="muted">当前用户：<?= htmlspecialchars($user['name'] ?? 'OAuth user') ?> · 数据库：<?= htmlspecialchars($dbDriver) ?></p>
    <form method="post" action="/sync/afdian"><button>立即轮询爱发电订单</button></form>
</section>
<section class="grid">
    <?php foreach ($stats as $status => $count): ?>
        <div class="card"><div class="muted"><?= htmlspecialchars($status) ?></div><div class="stat"><?= (int) $count ?></div></div>
    <?php endforeach; ?>
</section>
<section class="card">
    <h2>最近订单</h2>
    <?php require __DIR__ . '/partials/order-table.php'; ?>
</section>
<section class="card">
    <h2>接口</h2>
    <p>爱发电 Webhook：<code>POST /webhook/afdian</code></p>
    <p>VoiceHub 目标：<code><?= htmlspecialchars(($config->get('VOICEHUB_API_BASE') ?? '') . ($config->get('VOICEHUB_TICKET_ENDPOINT', '/api/song-tickets') ?? '')) ?></code></p>
</section>
