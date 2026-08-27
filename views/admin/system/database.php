<?php /** @var array $describe @var ?int $db_size @var string $schema_version @var array $applied @var ?string $installed_at @var ?string $last_migration @var ?string $analytics_last_rebuild @var array $backups @var \VoiceHubPay\App $__app */
$__pageTitle = '数据库';
$type = $describe['type'] ?? '—';
?>
<div class="card" style="max-width:760px;">
  <h3 class="card-title mb-3">数据库信息</h3>
  <div class="summary-row"><span class="muted">类型</span><span><span class="badge badge-<?= $type === 'PostgreSQL' ? 'blue' : 'green' ?>"><?= \VoiceHubPay\Http\View::e($type) ?></span></span></div>
  <div class="summary-row"><span class="muted">DSN</span><span class="small mono"><?= \VoiceHubPay\Http\View::e($describe['dsn'] ?? '') ?></span></div>
  <?php if ($db_size !== null): ?><div class="summary-row"><span class="muted">文件大小</span><span><?= number_format($db_size / 1024 / 1024, 2) ?> MB</span></div><?php endif; ?>
  <div class="summary-row"><span class="muted">Schema 最新版本</span><span class="mono small"><?= \VoiceHubPay\Http\View::e($schema_version) ?></span></div>
  <div class="summary-row"><span class="muted">已应用迁移</span><span class="small mono"><?= \VoiceHubPay\Http\View::e(implode(', ', $applied)) ?></span></div>
  <div class="summary-row"><span class="muted">安装时间</span><span class="small"><?= \VoiceHubPay\Http\View::datetime($installed_at) ?></span></div>
  <div class="summary-row"><span class="muted">Analytics 缓存重建</span><span class="small"><?= \VoiceHubPay\Http\View::datetime($analytics_last_rebuild) ?></span></div>
  <div class="flex mt-4">
    <button class="btn btn-secondary" id="check-db">健康检查</button>
    <form method="post" action="/admin/system/analytics/rebuild" data-confirm="重建 Analytics 缓存会重新扫描全部历史订单，确认？">
      <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
      <button class="btn btn-secondary">重建 Analytics</button>
    </form>
  </div>
  <div id="db-check-result" class="mt-3"></div>
</div>

<div class="card" style="max-width:760px;">
  <h3 class="card-title mb-3">备份（storage/backups）</h3>
  <?php if ($backups === []): ?>
    <div class="muted small">暂无备份。安装或迁移时系统会自动创建备份目录。</div>
  <?php endif; ?>
  <?php foreach ($backups as $b): ?>
    <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border);">
      <div>
        <div class="mono small"><?= \VoiceHubPay\Http\View::e($b['name']) ?></div>
        <div class="small muted"><?= (int) $b['files'] ?> 个文件 · <?= \VoiceHubPay\Http\View::datetime($b['mtime']) ?></div>
      </div>
      <span class="small muted">请通过文件系统 / FTP 手动下载保存</span>
    </div>
  <?php endforeach; ?>
  <div class="hint mt-3">旧版数据迁移前会自动生成 <code class="inline">legacy-YYYYmmdd-HHMMSS</code> 备份目录，旧数据库文件不会被删除。</div>
</div>

<script>
  document.getElementById('check-db').addEventListener('click', function () {
    var btn = this; btn.disabled = true; btn.textContent = '检查中…';
    var fd = new FormData(); fd.set('_csrf', VHP.csrf());
    fetch('/admin/system/database/check', { method: 'POST', credentials: 'same-origin', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var box = document.getElementById('db-check-result');
        var notice = document.createElement('div');
        if (j.ok && j.tables && typeof j.tables === 'object') {
          var bad = Object.keys(j.tables).filter(function (k) { return j.tables[k] !== 'ok'; });
          notice.className = 'alert alert-' + (bad.length ? 'error' : 'success');
          notice.textContent = bad.length ? '缺失表：' + bad.join(', ') : '全部 ' + Object.keys(j.tables).length + ' 张表正常 ✓';
        } else {
          notice.className = 'alert alert-error';
          notice.textContent = '检查失败：' + (j.error || '未知');
        }
        box.replaceChildren(notice);
        btn.disabled = false; btn.textContent = '健康检查';
      })
      .catch(function () { btn.disabled = false; btn.textContent = '健康检查'; });
  });
</script>
