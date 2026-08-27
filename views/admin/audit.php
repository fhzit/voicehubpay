<?php /** @var array $logs @var int $total @var int $page @var int $pages @var array $filters @var array $actions @var \VoiceHubPay\App $__app */
$__pageTitle = '操作日志';
$f = $filters;
?>
<div class="filters">
  <form method="get" action="/admin/audit" class="flex" style="gap:10px;flex-wrap:wrap;flex:1;">
    <input type="text" name="q" class="input search" placeholder="对象 ID / 关键字" value="<?= \VoiceHubPay\Http\View::e($f['q'] ?? '') ?>">
    <select name="action" class="select">
      <option value="">全部操作</option>
      <?php foreach ($actions as $a): ?>
        <option value="<?= \VoiceHubPay\Http\View::e($a) ?>" <?= ($f['action'] ?? '') === $a ? 'selected' : '' ?>><?= \VoiceHubPay\Http\View::e($a) ?></option>
      <?php endforeach; ?>
    </select>
    <input type="date" name="from" class="input" value="<?= \VoiceHubPay\Http\View::e($f['from'] ?? '') ?>">
    <input type="date" name="to" class="input" value="<?= \VoiceHubPay\Http\View::e($f['to'] ?? '') ?>">
    <button class="btn btn-secondary">筛选</button>
  </form>
</div>

<div class="card card-pad-0">
  <div class="table-wrap"><table class="table">
    <thead><tr><th>时间</th><th>用户</th><th>操作</th><th>对象</th><th>详情</th><th>IP</th></tr></thead>
    <tbody>
    <?php if ($logs === []): ?>
      <tr><td colspan="6" class="text-center muted">暂无日志</td></tr>
    <?php endif; ?>
    <?php foreach ($logs as $log): ?>
      <tr>
        <td class="small muted"><?= \VoiceHubPay\Http\View::datetime($log['created_at']) ?></td>
        <td class="small"><?= \VoiceHubPay\Http\View::e($log['username'] ?? ('#' . (int) $log['user_id'])) ?></td>
        <td><code class="inline"><?= \VoiceHubPay\Http\View::e($log['action']) ?></code></td>
        <td class="small"><?= \VoiceHubPay\Http\View::e($log['object_type']) ?> <span class="mono"><?= \VoiceHubPay\Http\View::e($log['object_id']) ?></span></td>
        <td class="small" style="max-width:320px;">
          <?php $meta = json_decode((string) $log['metadata'], true) ?: []; ?>
          <?php if ($meta): ?>
            <details class="toggle">
              <summary class="small">查看详情</summary>
              <pre class="json mt-2"><?= \VoiceHubPay\Http\View::e(json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)) ?></pre>
            </details>
          <?php else: ?><span class="faint">—</span><?php endif; ?>
        </td>
        <td class="small mono"><?= \VoiceHubPay\Http\View::e($log['ip'] ?? '') ?></td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table></div>
</div>

<?php if ($pages > 1): ?>
  <div class="pagination">
    <?php for ($i = 1; $i <= $pages; $i++): ?>
      <?php if ($i === $page): ?><span class="current"><?= $i ?></span><?php else: ?><a href="/admin/audit?<?= \VoiceHubPay\Http\View::e(http_build_query(array_filter($f))) ?>&page=<?= $i ?>"><?= $i ?></a><?php endif; ?>
    <?php endfor; ?>
  </div>
<?php endif; ?>
