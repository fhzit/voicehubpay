<section class="card hero">
    <div class="card-header">
        <div>
            <h1>管理面板</h1>
            <p class="muted">当前用户：<?= htmlspecialchars($user['name'] ?? 'OAuth user') ?> · 数据库：<?= htmlspecialchars($dbDriver) ?></p>
        </div>
        <form method="post" action="/sync/afdian"><button>立即轮询爱发电订单</button></form>
    </div>
</section>
<section class="grid">
    <?php foreach ($stats as $status => $count): ?>
        <div class="card"><div class="muted"><?= htmlspecialchars($status) ?></div><div class="stat"><?= (int) $count ?></div></div>
    <?php endforeach; ?>
</section>
<section class="card">
    <div class="card-header">
        <div>
            <h2>最近订单</h2>
            <p class="muted">展示最近 10 条爱发电订单及 VoiceHub 派发状态。</p>
        </div>
        <a class="button secondary" href="/orders">查看全部</a>
    </div>
    <?php require __DIR__ . '/partials/order-table.php'; ?>
</section>
<section class="card">
    <h2>接口</h2>
    <p>爱发电 Webhook：<code>POST /webhook/afdian</code></p>
    <p>VoiceHub 目标：<code><?= htmlspecialchars(($config->get('VOICEHUB_API_BASE') ?? '') . ($config->get('VOICEHUB_TICKET_ENDPOINT', '/api/song-tickets') ?? '')) ?></code></p>
</section>
