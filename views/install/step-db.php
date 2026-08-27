<?php /** @var array $state @var array $env @var \VoiceHubPay\App $__app @var ?array $__flash */
$db = $state['db'] ?? ['connection' => 'sqlite'];
$envHasPg = false;
foreach ($env as $c) { if ($c['label'] === 'PostgreSQL 驱动' && $c['ok']) { $envHasPg = true; } }
?>
<div class="steps" aria-label="安装进度">
  <?php for ($i = 1; $i <= 7; $i++): ?><div class="step <?= $i === 2 ? 'active' : ($i < 2 ? 'done' : '') ?>"><?= $i ?></div><?php endfor; ?>
</div>

<div class="install-card">
  <h2>第二步 · 数据库配置</h2>
  <p class="ic-sub">SQLite 零配置开箱即用；PostgreSQL 适合生产环境</p>

  <?php if ($state['error'] ?? null): ?><div class="alert alert-error" style="margin-bottom:16px;"><?= \VoiceHubPay\Http\View::e($state['error']) ?></div><?php endif; ?>

  <form method="post" action="/install?step=2">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <input type="hidden" name="step" value="2">
    <label class="label">数据库类型</label>
    <div class="db-cards" style="margin-bottom:22px;">
      <div class="db-card <?= ($db['connection'] ?? 'sqlite') === 'sqlite' ? 'active' : '' ?>" data-db="sqlite">
        <div class="db-title"><span class="pm-ico" style="width:26px;height:26px;color:var(--accent);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg></span>SQLite</div>
        <p class="db-desc">零配置，单文件数据库，适合个人站与小流量站点</p>
      </div>
      <div class="db-card <?= ($db['connection'] ?? '') === 'pgsql' ? 'active' : '' ?> <?= $envHasPg ? '' : 'is-disabled' ?>" data-db="pgsql">
        <div class="db-title"><span class="pm-ico" style="width:26px;height:26px;color:var(--primary);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg></span>PostgreSQL</div>
        <p class="db-desc"><?= $envHasPg ? '生产推荐，支持高并发与远程数据库' : '未检测到 pdo_pgsql 扩展' ?></p>
      </div>
    </div>
    <input type="hidden" name="db_connection" id="db_connection" value="<?= \VoiceHubPay\Http\View::e($db['connection'] ?? 'sqlite') ?>">

    <div id="sqlite-fields">
      <div class="field">
        <label class="label">数据库文件路径</label>
        <input class="input" type="text" name="db_sqlite_database" value="<?= \VoiceHubPay\Http\View::e(($db['connection'] ?? 'sqlite') === 'sqlite' ? ($db['database'] ?? 'storage/voicehubpay.sqlite') : 'storage/voicehubpay.sqlite') ?>">
        <div class="hint">相对站点根目录或绝对路径，SQLite 文件会自动创建</div>
      </div>
    </div>

    <div id="pgsql-fields" style="display:none;">
      <div class="form-grid">
        <div class="field"><label class="label">主机</label><input class="input" type="text" name="db_host" value="<?= \VoiceHubPay\Http\View::e($db['host'] ?? '127.0.0.1') ?>"></div>
        <div class="field"><label class="label">端口</label><input class="input" type="text" name="db_port" value="<?= \VoiceHubPay\Http\View::e($db['port'] ?? '5432') ?>"></div>
      </div>
      <div class="field"><label class="label">数据库名</label><input class="input" type="text" name="db_pgsql_database" value="<?= \VoiceHubPay\Http\View::e(($db['connection'] ?? '') === 'pgsql' ? ($db['database'] ?? 'voicehubpay') : 'voicehubpay') ?>"></div>
      <div class="form-grid">
        <div class="field"><label class="label">用户名</label><input class="input" type="text" name="db_username" value="<?= \VoiceHubPay\Http\View::e($db['username'] ?? '') ?>" autocomplete="off"></div>
        <div class="field">
          <label class="label">密码</label>
          <div class="flex" style="gap:8px;">
            <input class="input" type="password" id="db_password" name="db_password" value="" autocomplete="new-password">
            <button class="btn btn-outline" type="button" data-pw-toggle="db_password" style="flex:none;height:40px;">显示</button>
          </div>
        </div>
      </div>
    </div>

    <div class="install-actions" style="justify-content:flex-end;">
      <button class="btn btn-primary btn-lg">测试并保存连接</button>
    </div>
  </form>
</div>

<script>
document.addEventListener('DOMContentLoaded', function () {
  var hid = document.getElementById('db_connection');
  var cards = document.querySelectorAll('.db-card');
  function pick(name) {
    cards.forEach(function (c) {
      c.classList.toggle('active', c.getAttribute('data-db') === name && !c.classList.contains('is-disabled'));
    });
    var pg = name === 'pgsql';
    document.getElementById('sqlite-fields').style.display = pg ? 'none' : '';
    document.getElementById('pgsql-fields').style.display = pg ? '' : 'none';
  }
  cards.forEach(function (c) {
    c.addEventListener('click', function () {
      var name = c.getAttribute('data-db');
      if (c.classList.contains('is-disabled')) { return; }
      hid.value = name; pick(name);
    });
  });
  pick(hid.value);
});
</script>
