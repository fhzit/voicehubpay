<?php /** @var array $deliveries @var int $total @var int $page @var int $pages @var array $filters @var array $stats @var \VoiceHubPay\App $__app */
$__pageTitle = 'VoiceHub 发货';
$f = $filters;
$sourceLabels = ['inventory' => '库存卡密', 'shop_order_no' => '商城订单号', 'afdian_order_no' => '爱发电订单号'];
?>
<div class="stat-grid" style="margin-bottom:16px;grid-template-columns:repeat(4,1fr);">
  <div class="stat-card"><div class="stat-label">总请求</div><div class="stat-value"><?= (int) $stats['total'] ?></div></div>
  <div class="stat-card"><div class="stat-label">成功</div><div class="stat-value" style="color:var(--green);"><?= (int) $stats['success'] ?></div></div>
  <div class="stat-card"><div class="stat-label">失败</div><div class="stat-value" style="color:var(--red);"><?= (int) $stats['failed'] ?></div></div>
  <div class="stat-card"><div class="stat-label">今日请求</div><div class="stat-value"><?= (int) $stats['today'] ?></div></div>
</div>

<div class="filters">
  <form method="get" action="/admin/voicehub" class="flex" style="gap:10px;flex-wrap:wrap;flex:1;">
    <input type="text" name="q" class="input search" placeholder="订单号/来源单号" value="<?= \VoiceHubPay\Http\View::e($f['q'] ?? '') ?>">
    <select name="status" class="select">
      <option value="">全部状态</option>
      <?php foreach (['success' => '成功', 'failed' => '失败', 'processing' => '处理中', 'pending' => '待处理', 'not_required' => '无需推送'] as $sk => $sl): ?>
        <option value="<?= $sk ?>" <?= ($f['status'] ?? '') === $sk ? 'selected' : '' ?>><?= $sl ?></option>
      <?php endforeach; ?>
    </select>
    <select name="code_source" class="select">
      <option value="">全部来源</option>
      <?php foreach ($sourceLabels as $sk => $sl): ?>
        <option value="<?= $sk ?>" <?= ($f['code_source'] ?? '') === $sk ? 'selected' : '' ?>><?= $sl ?></option>
      <?php endforeach; ?>
    </select>
    <button class="btn btn-secondary">筛选</button>
  </form>
  <a href="/admin/voicehub/failures" class="btn btn-danger">失败中心 (<?= (int) $stats['failed'] ?>)</a>
</div>

<div class="card card-pad-0">
  <div class="table-wrap"><table class="table">
    <thead><tr><th>ID</th><th>来源单号</th><th>码（掩码）</th><th>来源</th><th>状态</th><th>尝试</th><th>错误</th><th>时间</th><th></th></tr></thead>
    <tbody>
    <?php if ($deliveries === []): ?>
      <tr><td colspan="9" class="text-center muted">暂无推送记录</td></tr>
    <?php endif; ?>
    <?php foreach ($deliveries as $d): ?>
      <tr>
        <td class="small mono faint">#<?= (int) $d['id'] ?></td>
        <td class="mono small"><?= \VoiceHubPay\Http\View::e($d['source_order_no']) ?></td>
        <td class="mono small"><?= \VoiceHubPay\Http\View::e($d['code_masked']) ?></td>
        <td class="small"><?= \VoiceHubPay\Http\View::e($sourceLabels[$d['code_source']] ?? $d['code_source']) ?></td>
        <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'delivery', 'status' => $d['status']]) ?></td>
        <td><?= (int) $d['attempts'] ?></td>
        <td class="small" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="<?= \VoiceHubPay\Http\View::e($d['last_error'] ?? '') ?>"><?= \VoiceHubPay\Http\View::e($d['last_error'] ?? '') ?></td>
        <td class="small muted"><?= \VoiceHubPay\Http\View::datetime($d['updated_at']) ?></td>
        <td>
          <?php if ($d['status'] === 'failed'): ?>
            <form method="post" action="/admin/voicehub/retry" data-confirm="确认重试该推送？将再次调用 VoiceHub（每次一个 code）。">
              <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
              <input type="hidden" name="delivery_id" value="<?= (int) $d['id'] ?>">
              <button class="btn btn-secondary btn-sm">重试</button>
            </form>
          <?php else: ?><span class="small faint">—</span><?php endif; ?>
        </td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table></div>
</div>

<?php if ($pages > 1): ?>
  <div class="pagination">
    <?php for ($i = 1; $i <= $pages; $i++): ?>
      <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="/admin/voicehub?<?= \VoiceHubPay\Http\View::e(http_build_query(array_filter($f))) ?>&page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
    <?php endfor; ?>
  </div>
<?php endif; ?>
