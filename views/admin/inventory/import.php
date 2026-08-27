<?php /** @var array $products @var \VoiceHubPay\App $__app */
$__pageTitle = '导入卡密';
?>
<div style="max-width:680px;margin:0 auto;">
  <div class="page-head">
    <h1 class="page-title" style="font-size:24px;">批量导入卡密</h1>
    <p class="page-sub">每行一条卡密（卡号----密码 / 卡号:密码 / 单条纯卡密），主密钥加密存储，仅展示掩码。</p>
  </div>

  <div class="card" style="padding:28px;">
    <form method="post" action="/admin/inventory/import">
      <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
      <div class="field">
        <label class="label">目标商品 *</label>
        <select name="product_id" class="select" required>
          <option value="">请选择商品（仅库存型商品可选）</option>
          <?php foreach ($products as $p): ?>
            <option value="<?= (int) $p['id'] ?>"><?= \VoiceHubPay\Http\View::e($p['name']) ?>（可售 <?= (int) $p['stock_available'] ?>）</option>
          <?php endforeach; ?>
        </select>
      </div>
      <div class="field">
        <label class="label">卡密内容 *</label>
        <div class="dropzone">
          <textarea class="textarea" name="cards_text" rows="14" required style="background:var(--surface-secondary);font-family:var(--mono);font-size:13px;" placeholder="每行一条，例如：&#10;ABC123456789----QWERTYUIOP&#10;DEF987654321:ASDFGHJKLZ&#10;GHI111222333"></textarea>
        </div>
        <div class="hint">相同卡密会自动去重（按 SHA-256 哈希），不会重复入库。</div>
      </div>
      <div class="flex">
        <button class="btn btn-primary">开始导入</button>
        <a href="/admin/inventory" class="btn btn-outline">返回库存</a>
      </div>
    </form>
  </div>
</div>
