<?php /** @var array $categories @var \VoiceHubPay\App $__app */
$__pageTitle = '商品分类';
?>
<div class="grid" style="grid-template-columns:1fr 1.2fr;align-items:start;">
  <div class="card">
    <h3 class="card-title mb-4">新建分类</h3>
    <form method="post" action="/admin/categories/save">
      <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
      <div class="field">
        <label class="label">分类名称</label>
        <input class="input" type="text" name="name" required>
      </div>
      <div class="field">
        <label class="label">排序权重</label>
        <input class="input" type="number" name="sort_order" value="0">
      </div>
      <button class="btn btn-primary">创建分类</button>
    </form>
  </div>

  <div class="card card-pad-0">
    <div class="table-wrap"><table class="table">
      <thead><tr><th>名称</th><th>别名</th><th>商品数</th><th>排序</th><th>状态</th><th class="text-right">操作</th></tr></thead>
      <tbody>
      <?php if ($categories === []): ?>
        <tr><td colspan="6" class="text-center muted">暂无分类</td></tr>
      <?php endif; ?>
      <?php foreach ($categories as $c): ?>
        <tr>
          <td style="font-weight:600;"><?= \VoiceHubPay\Http\View::e($c['name']) ?></td>
          <td class="small mono"><?= \VoiceHubPay\Http\View::e($c['slug']) ?></td>
          <td><?= (int) $c['product_count'] ?></td>
          <td><?= (int) $c['sort_order'] ?></td>
          <td><?= $__app->view->partial('partials/status-badge', ['kind' => 'status', 'status' => $c['status']]) ?></td>
          <td class="text-right">
            <details class="toggle">
              <summary class="small">编辑 / 删除</summary>
              <form method="post" action="/admin/categories/save" class="mt-3">
                <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
                <input type="hidden" name="id" value="<?= (int) $c['id'] ?>">
                <div class="field"><input class="input" type="text" name="name" value="<?= \VoiceHubPay\Http\View::e($c['name']) ?>" required></div>
                <div class="field"><input class="input" type="text" name="slug" value="<?= \VoiceHubPay\Http\View::e($c['slug']) ?>"></div>
                <div class="field">
                  <select name="status" class="select">
                    <option value="active" <?= $c['status'] === 'active' ? 'selected' : '' ?>>上架</option>
                    <option value="disabled" <?= $c['status'] === 'disabled' ? 'selected' : '' ?>>隐藏</option>
                  </select>
                </div>
                <div class="flex">
                  <button class="btn btn-primary btn-sm">保存</button>
                </div>
              </form>
              <form method="post" action="/admin/categories/delete" data-confirm="确定删除分类「<?= \VoiceHubPay\Http\View::e($c['name']) ?>」？" class="mt-2">
                <input type="hidden" name="_csrf" value="<?= \VoiceHubPay\Security\Csrf::token() ?>">
                <input type="hidden" name="id" value="<?= (int) $c['id'] ?>">
                <button class="btn btn-danger btn-sm">删除分类</button>
              </form>
            </details>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table></div>
  </div>
</div>
