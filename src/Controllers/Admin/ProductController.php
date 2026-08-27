<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class ProductController extends Controller
{
    public function __construct(App $app)
    {
        parent::__construct($app);
    }

    public function index(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $q = $request->string('q');
        $status = $request->string('status');
        $categoryId = $request->int('category', 0) ?: null;
        $page = max(1, $request->int('page', 1));
        $result = $this->app->make('products')->listAdmin($q, $status, $categoryId, $page, 20);
        $categories = $this->app->make('categories')->listAll();
        return $this->render('admin/products/index', [
            'products' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
            'q' => $q,
            'status' => $status,
            'category_id' => $categoryId,
            'categories' => $categories,
        ], 'admin');
    }

    public function createForm(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $categories = $this->app->make('categories')->listActive();
        return $this->render('admin/products/edit', [
            'product' => null,
            'categories' => $categories,
        ], 'admin');
    }

    public function editForm(Request $request, array $params): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $product = $this->app->make('products')->findById((int) ($params['id'] ?? 0));
        if ($product === null) {
            return $this->redirect('/admin/products')->withFlash('商品不存在。', 'error');
        }
        $categories = $this->app->make('categories')->listActive();
        return $this->render('admin/products/edit', [
            'product' => $product,
            'categories' => $categories,
        ], 'admin');
    }

    public function save(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $id = $request->int('id', 0);
        $products = $this->app->make('products');
        $name = trim($request->string('name'));
        if ($name === '') {
            return $this->redirect('/admin/products' . ($id ? '/edit/' . $id : '/create'))->withFlash('商品名称不能为空。', 'error');
        }
        try {
            $priceCents = \VoiceHubPay\Support\Money::toCents($request->string('price'));
        } catch (\InvalidArgumentException) {
            return $this->redirect('/admin/products' . ($id ? '/edit/' . $id : '/create'))->withFlash('请输入有效的商品价格。', 'error');
        }
        if ($priceCents <= 0) {
            return $this->redirect('/admin/products' . ($id ? '/edit/' . $id : '/create'))->withFlash('商品价格必须大于 0。', 'error');
        }
        $deliveryMode = $request->string('delivery_mode', 'card');
        if (!in_array($deliveryMode, ['card', 'voicehub', 'card_and_voicehub', 'manual'], true)) {
            $deliveryMode = 'card';
        }
        $voicehubSource = $request->string('voicehub_code_source', 'inventory');
        if (!in_array($voicehubSource, ['inventory', 'order_no'], true)) {
            $voicehubSource = 'inventory';
        }
        // voicehub mode always uses order_no as its code source.
        if ($deliveryMode === 'voicehub') {
            $voicehubSource = 'order_no';
        }

        $data = [
            'category_id' => $request->int('category_id', 0) ?: null,
            'name' => $name,
            'slug' => trim($request->string('slug')) ?: $products->uniqueSlug($name, $id ?: null),
            'description' => $request->string('description'),
            'cover_image' => $request->string('cover_image'),
            'price_cents' => $priceCents,
            'status' => in_array($request->string('status', 'draft'), ['draft', 'active', 'disabled'], true) ? $request->string('status', 'draft') : 'draft',
            'delivery_mode' => $deliveryMode,
            'voicehub_enabled' => in_array($deliveryMode, ['voicehub', 'card_and_voicehub'], true) && $request->int('voicehub_enabled', 0) === 1 ? 1 : 0,
            'voicehub_code_source' => $voicehubSource,
            'stock_enabled' => $deliveryMode === 'voicehub' ? 0 : $request->int('stock_enabled', 1),
            'min_quantity' => max(1, $request->int('min_quantity', 1)),
            'max_quantity' => max(1, $request->int('max_quantity', 99)),
            'quantity_step' => max(1, $request->int('quantity_step', 1)),
            'low_stock_threshold' => max(0, $request->int('low_stock_threshold', 0)),
            'sort_order' => $request->int('sort_order', 0),
        ];

        if ($id > 0) {
            $products->update($id, $data);
            $this->audit($this->adminUserId(), 'product.update', 'product', (string) $id, ['name' => $name], $request);
            $this->flash('商品已更新。');
            return $this->redirect('/admin/products');
        }
        $created = $products->create($data);
        $this->audit($this->adminUserId(), 'product.create', 'product', (string) $created['id'], ['name' => $name], $request);
        $this->flash('商品已创建。');
        return $this->redirect('/admin/products');
    }

    public function toggleStatus(Request $request, array $params): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $id = (int) ($params['id'] ?? 0);
        $product = $this->app->make('products')->findById($id);
        if ($product === null) {
            return $this->redirect('/admin/products')->withFlash('商品不存在。', 'error');
        }
        $newStatus = $product['status'] === 'active' ? 'disabled' : 'active';
        $this->app->make('products')->setStatus($id, $newStatus);
        $this->audit($this->adminUserId(), 'product.status', 'product', (string) $id, ['to' => $newStatus], $request);
        return $this->redirect('/admin/products')->withFlash('商品已' . ($newStatus === 'active' ? '上架' : '下架') . '。');
    }

    public function delete(Request $request, array $params): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $id = (int) ($params['id'] ?? 0);
        $product = $this->app->make('products')->findById($id);
        if ($product === null) {
            return $this->redirect('/admin/products')->withFlash('商品不存在。', 'error');
        }
        $mode = $this->app->make('products')->deleteOrDisable($id);
        $this->audit($this->adminUserId(), 'product.delete', 'product', (string) $id, ['mode' => $mode, 'name' => $product['name']], $request);
        $msg = $mode === 'disabled' ? '该商品存在历史订单，已改为下架（软删除）。' : '商品已删除。';
        return $this->redirect('/admin/products')->withFlash($msg);
    }

}
