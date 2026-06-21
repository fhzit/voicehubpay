<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>voicehubpay</title>
    <style>
        body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#0f172a;color:#e2e8f0}a{color:#93c5fd}main{max-width:1100px;margin:0 auto;padding:32px}.nav{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-bottom:24px}.card{background:#111827;border:1px solid #334155;border-radius:14px;padding:20px;margin-bottom:18px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}.stat{font-size:30px;font-weight:700}.muted{color:#94a3b8}.btn,button{background:#2563eb;color:white;border:0;border-radius:10px;padding:10px 14px;cursor:pointer}.danger{background:#dc2626}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #334155;text-align:left}code{background:#020617;padding:2px 6px;border-radius:6px}.pill{border-radius:999px;padding:4px 9px;background:#334155}.created{background:#166534}.failed{background:#7f1d1d}.pending{background:#854d0e}.flash{background:#064e3b;padding:12px;border-radius:10px;margin-bottom:16px}
    </style>
</head>
<body>
<main>
    <div class="nav">
        <div><strong>voicehubpay</strong> <span class="muted">Afdian → VoiceHub</span></div>
        <div>
            <a href="/">仪表盘</a> · <a href="/orders">订单</a>
            <form method="post" action="/auth/logout" style="display:inline"><button class="danger">退出</button></form>
        </div>
    </div>
    <?php if (!empty($_SESSION['flash'])): ?><div class="flash"><?= htmlspecialchars($_SESSION['flash']); unset($_SESSION['flash']); ?></div><?php endif; ?>
    <?= $content ?>
</main>
</body>
</html>
