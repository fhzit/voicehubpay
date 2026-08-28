<?php /** @var string $range @var string $channel @var string $custom_from @var string $custom_to @var array $kpis @var array $trends @var array $ranking @var array $inventory @var array $vh_sources @var array $recent_failures @var array $afdian_stats @var \VoiceHubPay\App $__app */
$__pageTitle = '仪表盘';
$k = $kpis['current'] ?? $kpis;
$d = $kpis['deltas'] ?? [];
$maxIncome = max(1, max(array_column($trends['income'], 'total') ?: [0]));
/* ---- SVG line-chart geometry helpers ---- */
$chart = static function () use ($trends, $maxIncome): string {
    $rows = $trends['income'];                 // [label, total, shop, afdian]
    if ($rows === []) {
        return '';
    }
    $W = 640; $H = 185; $pl = 10; $pr = 10; $pt = 12; $pb = 26;
    $plotW = $W - $pl - $pr; $plotH = $H - $pt - $pb;
    $n = count($rows);
    $xAt = fn (int $i): float => $n === 1 ? $pl + $plotW / 2 : $pl + ($plotW * $i) / ($n - 1);
    $yAt = fn (int $v): float => $pt + $plotH - ($v / $maxIncome) * $plotH;

    $pts = static function (string $key) use ($rows, $xAt, $yAt): array {
        $out = [];
        foreach ($rows as $i => $r) {
            $out[] = round($xAt($i), 1) . ',' . round($yAt((int) $r[$key]), 1);
        }
        return $out;
    };
    // build
    $svg = '<svg class="line-chart" viewBox="0 0 ' . $W . ' ' . $H . '" role="img" aria-label="收入趋势折线图">';
    // horizontal gridlines — Y-axis labels are shown in 元 (maxIncome is cents)
    for ($g = 0; $g <= 4; $g++) {
        $gy = $pt + $plotH * $g / 4;
        $valYuan = ($maxIncome * (4 - $g)) / 4 / 100;
        $svg .= '<line x1="' . $pl . '" y1="' . round($gy, 1) . '" x2="' . ($W - $pr) . '" y2="' . round($gy, 1) . '" class="lc-grid"/>';
        $svg .= '<text x="' . ($pl + 2) . '" y="' . round($gy - 4, 1) . '" class="lc-axis-val">' . ($valYuan > 0 ? number_format($valYuan, 2) : 0) . '</text>';
    }
    // area fills
    foreach (['shop', 'afdian'] as $key) {
        $ptsArr = $pts($key);
        $area = 'M' . $ptsArr[0] . ' L' . implode(' L', $ptsArr) . ' L' . $xAt($n - 1) . ',' . $yAt(0) . ' L' . $xAt(0) . ',' . $yAt(0) . ' Z';
        $svg .= '<path d="' . $area . '" class="lc-fill lc-fill-' . $key . '"></path>';
    }
    // lines
    foreach (['shop' => 'lc-line-shop', 'afdian' => 'lc-line-afdian'] as $key => $cls) {
        $svg .= '<polyline class="lc-line ' . $cls . '" points="' . implode(' ', $pts($key)) . '" fill="none"/>';
    }
    // dots + hover hit areas (each data point gets an invisible large circle that
    // drives a custom tooltip showing 时段 / 总额 / 商城 / 爱发电)
    foreach ($rows as $i => $r) {
        $xx = round($xAt($i), 1);
        $yyShop = round($yAt((int) $r['shop']), 1);
        $yyAf = round($yAt((int) $r['afdian']), 1);
        $vShop = (int) $r['shop']; $vAf = (int) $r['afdian'];
        $vTotal = (int) $r['total'];
        $tipHtml = '<span class="lc-key">' . \VoiceHubPay\Http\View::e($r['label']) . '</span>'
            . '<span class="lc"><i class="lc-dot-mini" style="background:var(--chart-2);"></i>商城<span class="lc-val">¥' . \VoiceHubPay\Http\View::money($vShop) . '</span></span>'
            . '<span class="lc"><i class="lc-dot-mini" style="background:var(--chart-5);"></i>爱发电<span class="lc-val">¥' . \VoiceHubPay\Http\View::money($vAf) . '</span></span>'
            . '<span class="lc-sep"></span>'
            . '<span class="lc"><b>总额</b><span class="lc-val lc-val-total">¥' . \VoiceHubPay\Http\View::money($vTotal) . '</span></span>';
        $dot = function (float $yy, string $cls) use ($xx, $tipHtml): string {
            // data-tip holds HTML that JS injects via innerHTML, so only the
            // double-quote attribute delimiter must be encoded — do NOT Entity-encode
            // the inner tags (View::e would turn them into visible text).
            $attrSafe = str_replace('"', '&quot;', $tipHtml);
            return '<circle cx="' . $xx . '" cy="' . round($yy, 1) . '" r="3" class="' . $cls . '"></circle>'
                . '<circle cx="' . $xx . '" cy="' . round($yy, 1) . '" r="11" class="lc-hit" data-tip="' . $attrSafe . '"></circle>';
        };
        // draw dots for every point in the range; the hit area always present
        // so the user can hover each bucket even when its value is zero.
        $svg .= $dot($yyShop, 'lc-dot lc-dot-shop');
        $svg .= $dot($yyAf, 'lc-dot lc-dot-afdian');
    }
    // x labels (thin to <=8)
    $step = max(1, (int) ceil($n / 8));
    foreach ($rows as $i => $r) {
        if ($i % $step !== 0 && $i !== $n - 1) {
            continue;
        }
        $xx = round($xAt($i), 1);
        $svg .= '<text x="' . $xx . '" y="' . ($H - 8) . '" class="lc-axis" text-anchor="middle">' . \VoiceHubPay\Http\View::e($r['label']) . '</text>';
    }
    $svg .= '</svg>';
    return $svg;
};
$chartSvg = $chart();
$deltaHtml = static function ($name, float $val): string {
    if ($val > 0) { return '<span class="stat-delta up">▲ ' . number_format($val, 1) . '%</span>'; }
    if ($val < 0) { return '<span class="stat-delta down">▼ ' . number_format(abs($val), 1) . '%</span>'; }
    return '<span class="stat-delta flat">与上期持平</span>';
};
$channel = $channel ?? 'all';
$range = $range ?? 'today';
$custom_from = $custom_from ?? '';
$custom_to = $custom_to ?? '';
?>
<div class="filters" style="margin-bottom:20px;">
  <span class="small muted">统计范围</span>
  <?php foreach (['today' => '今日', 'week' => '本周', 'month' => '本月'] as $rk => $rl): ?>
    <a href="/admin?range=<?= $rk ?>&channel=<?= $channel ?>" class="btn btn-sm <?= $range === $rk ? 'btn-primary' : 'btn-secondary' ?>"><?= $rl ?></a>
  <?php endforeach; ?>
  <span class="small muted" style="margin-left:8px;">渠道</span>
  <?php foreach (['all' => '全部', 'shop' => '商城', 'afdian' => '爱发电'] as $ck => $cl): ?>
    <a href="/admin?range=<?= $range ?>&channel=<?= $ck ?>" class="btn btn-sm <?= $channel === $ck ? 'btn-primary' : 'btn-secondary' ?>"><?= $cl ?></a>
  <?php endforeach; ?>
  <form method="get" action="/admin" class="flex" style="gap:8px;margin-left:auto;">
    <input type="hidden" name="range" value="custom">
    <input type="hidden" name="channel" value="<?= $channel ?>">
    <input type="date" name="from" class="input" value="<?= \VoiceHubPay\Http\View::e($custom_from) ?>">
    <input type="date" name="to" class="input" value="<?= \VoiceHubPay\Http\View::e($custom_to) ?>">
    <button class="btn btn-secondary btn-sm">自定义</button>
  </form>
</div>

<!-- 第一组：4 个核心 KPI（数字为核心，无大图标） -->
<div class="stat-grid">
  <div class="stat-card">
    <div class="stat-label">总营收</div>
    <div class="stat-value">¥<?= \VoiceHubPay\Http\View::money((int) $k['total_revenue']) ?></div>
    <?= $deltaHtml('total_revenue', (float) ($d['total_revenue'] ?? 0)) ?>
  </div>
  <div class="stat-card">
    <div class="stat-label">商城收入</div>
    <div class="stat-value">¥<?= \VoiceHubPay\Http\View::money((int) $k['shop_revenue']) ?></div>
    <?= $deltaHtml('shop_revenue', (float) ($d['shop_revenue'] ?? 0)) ?>
  </div>
  <div class="stat-card">
    <div class="stat-label">爱发电收入</div>
    <div class="stat-value">¥<?= \VoiceHubPay\Http\View::money((int) $k['afdian_revenue']) ?></div>
    <?= $deltaHtml('afdian_revenue', (float) ($d['afdian_revenue'] ?? 0)) ?>
  </div>
  <div class="stat-card">
    <div class="stat-label">客单价</div>
    <div class="stat-value">¥<?= \VoiceHubPay\Http\View::money((int) $k['avg_order_value']) ?></div>
    <div class="stat-delta flat">支付总额 / 订单数</div>
  </div>
</div>

<!-- 第二组：更小尺寸的操作指标 -->
<div class="stat-grid stat-grid-sm" style="margin-top:16px;">
  <div class="stat-card">
    <div class="stat-label">已支付订单</div>
    <div class="stat-value"><?= (int) $k['paid_orders'] ?></div>
    <div class="stat-delta flat">商城 <?= (int) $k['shop_orders'] ?> · 爱发电 <?= (int) $k['afdian_orders'] ?></div>
  </div>
  <div class="stat-card">
    <div class="stat-label">售出件数</div>
    <div class="stat-value"><?= (int) $k['sold_units'] ?></div>
    <?= $deltaHtml('sold_units', (float) ($d['sold_units'] ?? 0)) ?>
  </div>
  <div class="stat-card">
    <div class="stat-label">VoiceHub 请求</div>
    <div class="stat-value"><?= (int) $k['voicehub_requests'] ?></div>
    <?= $deltaHtml('voicehub_requests', (float) ($d['voicehub_requests'] ?? 0)) ?>
  </div>
  <div class="stat-card">
    <div class="stat-label">VoiceHub 成功率</div>
    <div class="stat-value" style="color:<?= (float) $k['voicehub_success_rate'] >= 90 ? 'var(--success)' : 'var(--destructive)' ?>"><?= $k['voicehub_success_rate'] ?><small>%</small></div>
    <div class="stat-delta flat">成功 <?= (int) $k['voicehub_success'] ?> · 失败 <?= (int) $k['voicehub_failed'] ?></div>
  </div>
</div>

<div class="grid" style="grid-template-columns: 1fr; gap:20px; margin-top:20px;">
  <!-- 收入趋势 + 渠道 -->
  <div class="grid dash-grid-2" style="gap:20px; align-items:start;">
    <div class="card">
      <div class="flex-between" style="margin-bottom:18px;">
        <h3 class="card-title">收入趋势</h3>
        <span class="legend">
          <span class="lg"><span class="sw" style="background:var(--chart-2);"></span>商城</span>
          <span class="lg"><span class="sw" style="background:var(--chart-5);"></span>爱发电</span>
        </span>
      </div>
      <?php if ($trends['income'] === []): ?>
        <div class="muted small text-center" style="padding:40px 0;">所选范围内暂无收入数据</div>
      <?php elseif ($chartSvg !== ''): ?>
        <div class="line-chart-wrap">
          <?= $chartSvg ?>
          <div class="lc-tooltip" id="lc-tooltip" hidden></div>
        </div>
      <?php endif; ?>
    </div>

    <div class="card">
      <h3 class="card-title" style="margin-bottom:16px;">渠道收入</h3>
      <div class="summary-row" style="font-size:14px;"><span>商城</span><span style="font-weight:700;">¥<?= \VoiceHubPay\Http\View::money((int) $k['shop_revenue']) ?></span></div>
      <div class="chart-row-item">
        <span class="cr-label">占比</span>
        <div class="cr-bar"><div class="progress-track" style="height:6px;"><div class="progress-fill is-success" style="width:<?= (float) ($trends['source_pct']['shop'] ?? 0) ?>%;"></div></div></div>
        <span class="cr-value"><?= (float) ($trends['source_pct']['shop'] ?? 0) ?>%</span>
      </div>
      <div class="summary-row" style="font-size:14px;margin-top:12px;"><span>爱发电</span><span style="font-weight:700;">¥<?= \VoiceHubPay\Http\View::money((int) $k['afdian_revenue']) ?></span></div>
      <div class="chart-row-item">
        <span class="cr-label">占比</span>
        <div class="cr-bar"><div class="progress-track" style="height:6px;"><div class="progress-fill" style="width:<?= (float) ($trends['source_pct']['afdian'] ?? 0) ?>%;background:var(--chart-5);"></div></div></div>
        <span class="cr-value"><?= (float) ($trends['source_pct']['afdian'] ?? 0) ?>%</span>
      </div>
      <div style="border-top:1px solid var(--border);margin:16px 0 12px;"></div>
      <div class="summary-row"><span class="muted">今日爱发电</span><span><?= (int) $afdian_stats['today_orders'] ?> 单 · ¥<?= \VoiceHubPay\Http\View::money((int) $afdian_stats['today_revenue']) ?></span></div>
      <div class="summary-row"><span class="muted">最近 Webhook</span><span class="small"><?= \VoiceHubPay\Http\View::datetime($afdian_stats['last_webhook']) ?></span></div>
      <div class="summary-row"><span class="muted">最近轮询</span><span class="small"><?= \VoiceHubPay\Http\View::datetime($afdian_stats['last_poll']) ?></span></div>
      <a href="/admin/afdian" class="btn btn-ghost btn-sm" style="margin-top:10px;">爱发电订单</a>
    </div>
  </div>

  <!-- VoiceHub Operations -->
  <div class="card">
    <div class="flex-between flex-wrap" style="margin-bottom:14px;">
      <div class="flex" style="gap:14px;">
        <h3 class="card-title">VoiceHub 发券状态</h3>
        <span class="status-dot <?= (float) $k['voicehub_success_rate'] >= 90 ? 'status-dot-success' : 'status-dot-warning' ?>"><?= (float) $k['voicehub_success_rate'] >= 90 ? '正常' : '需关注' ?></span>
      </div>
      <div class="flex" style="gap:18px;">
        <span class="small muted">成功率 <b style="color:var(--foreground);font-size:15px;"><?= $k['voicehub_success_rate'] ?>%</b></span>
        <span class="small muted">失败 <b style="color:var(--destructive);font-size:15px;"><?= (int) $k['voicehub_failed'] ?></b></span>
        <a href="/admin/voicehub/failures" class="btn btn-ghost btn-sm">失败中心</a>
      </div>
    </div>
    <div class="chart-row-item">
      <span class="cr-label">来源</span>
      <div class="cr-bar"></div>
      <span class="cr-value" style="width:120px;text-align:right;">成功 / 失败</span>
    </div>
    <?php $labels = ['inventory' => '库存卡密', 'shop_order_no' => '商城订单号', 'afdian_order_no' => '爱发电订单号']; ?>
    <?php foreach ($vh_sources as $key => $s): ?>
      <div class="chart-row-item">
        <span class="cr-label"><?= \VoiceHubPay\Http\View::e($labels[$key] ?? $key) ?></span>
        <div class="cr-bar">
          <?php $pct = (int) $s['total'] > 0 ? round((int) $s['success'] / (int) $s['total'] * 100) : 100; ?>
          <div class="progress-track"><div class="progress-fill <?= $pct >= 100 ? 'is-success' : '' ?>" style="width:<?= $pct ?>%;<?= $pct >= 100 ? '' : 'background:var(--warning);' ?>"></div></div>
        </div>
        <span class="cr-value" style="width:120px;text-align:right;"><?= (int) $s['success'] ?> / <?= (int) $s['failed'] ?></span>
      </div>
    <?php endforeach; ?>

    <?php if ($recent_failures !== []): ?>
      <div style="border-top:1px solid var(--border);margin-top:16px;padding-top:12px;">
        <div class="small muted" style="font-weight:600;margin-bottom:6px;">最近失败</div>
        <?php foreach (array_slice($recent_failures, 0, 5) as $f): ?>
          <div class="flex-between" style="gap:12px;padding:6px 0;">
            <span class="small mono" style="color:var(--foreground-secondary);"><?= \VoiceHubPay\Http\View::e($f['source_order_no']) ?></span>
            <span class="small" style="color:var(--muted-foreground);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><?= \VoiceHubPay\Http\View::e($f['last_error']) ?></span>
            <span class="badge badge-red">×<?= (int) $f['attempts'] ?></span>
          </div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </div>
</div>

<div class="section-head"><h2>经营明细</h2></div>
<div class="grid dash-grid-2" style="gap:20px;align-items:start;">
  <div class="card card-pad-0">
    <div class="card-header"><h3 class="card-title">商品销量排行</h3></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>商品</th><th class="num">售价</th><th class="num">销量</th><th class="num">销售额</th><th class="num">库存</th></tr></thead>
      <tbody>
      <?php if ($ranking === []): ?>
        <tr><td colspan="5" class="text-center muted">暂无数据</td></tr>
      <?php endif; ?>
      <?php foreach ($ranking as $r): ?>
        <tr>
          <td><?= \VoiceHubPay\Http\View::e($r['name']) ?></td>
          <td class="num">¥<?= \VoiceHubPay\Http\View::money((int) $r['price_cents']) ?></td>
          <td class="num"><?= (int) $r['sold_units'] ?></td>
          <td class="num">¥<?= \VoiceHubPay\Http\View::money((int) $r['revenue_cents']) ?></td>
          <td class="num"><?= (int) $r['stock_available'] ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table></div>
  </div>

  <div>
    <div class="card">
      <h3 class="card-title mb-3">库存概览</h3>
      <?php $invTotal = array_sum($inventory); ?>
      <div class="metric-seg" style="margin-bottom:14px;">
        <div><div class="m-label">可售</div><div class="m-value" style="color:var(--success);"><?= (int) $inventory['available'] ?></div></div>
        <div><div class="m-label">占用</div><div class="m-value" style="color:var(--accent);"><?= (int) $inventory['reserved'] ?></div></div>
        <div><div class="m-label">已售</div><div class="m-value"><?= (int) $inventory['sold'] ?></div></div>
        <div><div class="m-label">停用</div><div class="m-value" style="color:var(--muted-foreground);"><?= (int) $inventory['disabled'] ?></div></div>
      </div>
      <?php if ($invTotal > 0): ?>
        <div class="progress-track" style="height:8px;margin-bottom:14px;">
          <div class="progress-fill is-success" style="width:<?= round((int) $inventory['available'] / $invTotal * 100) ?>%;"></div>
        </div>
      <?php endif; ?>
      <a href="/admin/inventory" class="btn btn-ghost btn-sm">管理库存</a>
    </div>
    <div class="card" style="margin-top:20px;">
      <h3 class="card-title mb-3">运营状态</h3>
      <div class="summary-row"><span class="muted">人工完成</span><span style="color:var(--manual);font-weight:700;"><?= (int) $k['manual_completed'] ?></span></div>
      <div class="summary-row"><span class="muted">异常订单</span><span style="color:<?= (int) $k['abnormal_orders'] > 0 ? 'var(--destructive)' : 'var(--success)' ?>;font-weight:700;"><?= (int) $k['abnormal_orders'] ?></span></div>
      <?php if ((int) $k['abnormal_orders'] > 0): ?>
        <a href="/admin/orders?abnormal=1" class="btn btn-warning btn-sm" style="margin-top:10px;">处理异常订单</a>
      <?php endif; ?>
    </div>
  </div>
</div>

<script>
(function () {
  var wrap = document.querySelector('.line-chart-wrap');
  if (!wrap) return;
  var tip = document.getElementById('lc-tooltip');
  var svgEl = wrap.querySelector('svg.line-chart');
  if (!svgEl || !tip) return;

  function show(circle) {
    tip.innerHTML = circle.getAttribute('data-tip') || '';
    tip.hidden = false;
  }
  function hide() { tip.hidden = true; }
  function move(e) {
    if (tip.hidden) return;
    var rect = wrap.getBoundingClientRect();
    var top = (e.clientY - rect.top) + 14;
    var left = (e.clientX - rect.left) + 14;
    var tW = tip.offsetWidth;
    if (left + tW > rect.width) left = (e.clientX - rect.left) - tW - 14;
    if (left < 4) left = 4;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  wrap.addEventListener('mouseover', function (e) {
    var c = e.target.closest('.lc-hit');
    if (c) show(c);
  });
  wrap.addEventListener('mouseout', function (e) {
    if (!e.target.closest('.lc-hit')) hide();
  });
  wrap.addEventListener('mousemove', move);
})();
</script>
