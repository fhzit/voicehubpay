<?php /** @var ?array $product @var array $categories @var \VoiceHubPay\App $__app */
$__pageTitle = $product === null ? '新建商品' : '编辑商品';
$p = $product ?? [];
$mode = $p['delivery_mode'] ?? 'card';
$modeMap = [
    'card' => ['label' => '库存卡密', 'hint' => '购买后从库存卡密中扣除，加密发放', 'voicehub' => false, 'source' => 'inventory'],
    'voicehub' => ['label' => 'VoiceHub 发券', 'hint' => '每次购买用订单号生成一张 VoiceHub 券码（仅商城渠道）', 'voicehub' => true, 'source' => 'order_no'],
    'card_and_voicehub' => ['label' => '卡密 + VoiceHub 发券', 'hint' => '从库存发放卡密，同时以卡密为 code 推送到 VoiceHub', 'voicehub' => true, 'source' => 'inventory'],
    'manual' => ['label' => '人工发货', 'hint' => '下单后由管理员人工分配卡密', 'voicehub' => false, 'source' => 'inventory'],
];
?>
<div class="card" style="max-width:820px;">
  <form method="post" action="/admin/products/save">
    <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
    <input type="hidden" name="id" value="<?= (int) $p['id'] ?>">

    <div class="form-grid">
      <div class="field">
        <label class="label">商品名称 *</label>
        <input class="input" type="text" name="name" required value="<?= \VoiceHubPay\Http\View::e($p['name'] ?? '') ?>">
      </div>
      <div class="field">
        <label class="label">售价（元）*</label>
        <input class="input" type="text" name="price" required value="<?= $p['price_cents'] !== null ? \VoiceHubPay\Http\View::money((int) $p['price_cents']) : '' ?>" placeholder="例如 9.90">
      </div>
    </div>

    <div class="form-grid">
      <div class="field">
        <label class="label">分类</label>
        <select name="category_id" class="select">
          <option value="0">无分类</option>
          <?php foreach ($categories as $c): ?>
            <option value="<?= (int) $c['id'] ?>" <?= (int) ($p['category_id'] ?? 0) === (int) $c['id'] ? 'selected' : '' ?>><?= \VoiceHubPay\Http\View::e($c['name']) ?></option>
          <?php endforeach; ?>
        </select>
      </div>
      <div class="field">
        <label class="label">URL 别名（slug）</label>
        <input class="input" type="text" name="slug" value="<?= \VoiceHubPay\Http\View::e($p['slug'] ?? '') ?>" placeholder="留空自动生成">
      </div>
    </div>

    <div class="field">
      <label class="label">商品说明</label>
      <textarea class="textarea" name="description" rows="4" placeholder="商品介绍、使用说明、注意事项…"><?= \VoiceHubPay\Http\View::e($p['description'] ?? '') ?></textarea>
    </div>

    <div class="field">
      <label class="label">封面图 URL（可选）</label>
      <input class="input" type="text" name="cover_image" value="<?= \VoiceHubPay\Http\View::e($p['cover_image'] ?? '') ?>" placeholder="https://…/cover.png">
    </div>

    <div class="field">
      <label class="label">发货方式 *</label>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
        <?php foreach ($modeMap as $mk => $mv): ?>
          <label class="pay-method <?= $mode === $mk ? 'active' : '' ?>" style="text-align:left;display:block;">
            <input type="radio" name="delivery_mode" value="<?= $mk ?>" <?= $mode === $mk ? 'checked' : '' ?> style="margin-right:6px;">
            <strong><?= $mv['label'] ?></strong>
            <div class="small muted" style="font-weight:400;margin-top:4px;"><?= $mv['hint'] ?></div>
          </label>
        <?php endforeach; ?>
      </div>
    </div>

    <div class="form-grid" id="voicehub-fields" style="display:<?= in_array($mode, ['card_and_voicehub'], true) ? '' : 'none' ?>;">
      <div class="field">
        <label class="label">推送到 VoiceHub</label>
        <div class="checkbox-row">
          <input type="checkbox" name="voicehub_enabled" id="voicehub_enabled" value="1" <?= (int) ($p['voicehub_enabled'] ?? 0) === 1 ? 'checked' : '' ?>>
          <label for="voicehub_enabled" class="small muted">支付后以卡密为 code 调用 VoiceHub 发券</label>
        </div>
      </div>
      <div class="field">
        <label class="label">VoiceHub 码来源</label>
        <select name="voicehub_code_source" class="select" id="voicehub_code_source">
          <option value="inventory" <?= ($p['voicehub_code_source'] ?? 'inventory') === 'inventory' ? 'selected' : '' ?>>库存卡密（每张卡密推一个 code）</option>
          <option value="order_no" <?= ($p['voicehub_code_source'] ?? 'inventory') === 'order_no' ? 'selected' : '' ?>>商城订单号（每件生成 VH…-001 码）</option>
        </select>
        <div class="hint">仅商城渠道可配置；爱发电渠道固定使用订单号</div>
      </div>
    </div>

    <div class="form-grid">
      <div class="field">
        <label class="label">启用库存控制</label>
        <div class="checkbox-row">
          <input type="checkbox" name="stock_enabled" id="stock_enabled" value="1" <?= (int) ($p['stock_enabled'] ?? 1) === 1 ? 'checked' : '' ?>>
          <label for="stock_enabled" class="small muted">库存不足时禁止购买（VoiceHub 发券商品自动关闭）</label>
        </div>
      </div>
      <div class="field">
        <label class="label">低库存提醒阈值</label>
        <input class="input" type="number" name="low_stock_threshold" min="0" value="<?= (int) ($p['low_stock_threshold'] ?? 0) ?>">
      </div>
    </div>

    <div class="form-grid">
      <div class="field">
        <label class="label">最少购买数量</label>
        <input class="input" type="number" name="min_quantity" min="1" value="<?= (int) ($p['min_quantity'] ?? 1) ?>">
      </div>
      <div class="field">
        <label class="label">最多购买数量</label>
        <input class="input" type="number" name="max_quantity" min="1" value="<?= (int) ($p['max_quantity'] ?? 99) ?>">
      </div>
      <div class="field">
        <label class="label">购买步长</label>
        <input class="input" type="number" name="quantity_step" min="1" value="<?= (int) ($p['quantity_step'] ?? 1) ?>">
      </div>
      <div class="field">
        <label class="label">排序权重（越大越靠前）</label>
        <input class="input" type="number" name="sort_order" value="<?= (int) ($p['sort_order'] ?? 0) ?>">
      </div>
    </div>

    <div class="field">
      <label class="label">状态</label>
      <select name="status" class="select">
        <option value="active" <?= ($p['status'] ?? 'draft') === 'active' ? 'selected' : '' ?>>上架（前台可见可购）</option>
        <option value="draft" <?= ($p['status'] ?? 'draft') === 'draft' ? 'selected' : '' ?>>草稿（前台隐藏）</option>
        <option value="disabled" <?= ($p['status'] ?? 'draft') === 'disabled' ? 'selected' : '' ?>>下架（前台隐藏）</option>
      </select>
    </div>

    <div class="flex">
      <button class="btn btn-primary">保存商品</button>
      <a href="/admin/products" class="btn btn-secondary">返回列表</a>
    </div>
  </form>
</div>

<script>
  (function () {
    var radios = document.querySelectorAll('input[name="delivery_mode"]');
    function sync() {
      var v = document.querySelector('input[name="delivery_mode"]:checked').value;
      var vf = document.getElementById('voicehub-fields');
      if (vf) { vf.style.display = v === 'card_and_voicehub' ? '' : 'none'; }
      document.querySelectorAll('.pay-method').forEach(function (el) { el.classList.remove('active'); });
      document.querySelector('input[name="delivery_mode"]:checked').closest('.pay-method').classList.add('active');
    }
    radios.forEach(function (r) { r.addEventListener('change', sync); });
    sync();
  })();
</script>
