<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class InventoryController extends Controller
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
        $productId = $request->int('product', 0) ?: null;
        $status = $request->string('status');
        $page = max(1, $request->int('page', 1));
        $crypto = $this->app->crypto;

        $products = $this->app->make('products')->listAdmin('', '', null, 1, 500)['items'];
        if ($productId !== null && !$this->app->make('products')->findById($productId)) {
            $productId = null;
        }

        $inventory = $this->app->make('inventory');
        $stats = $productId !== null ? $inventory->stats($productId) : $inventory->totalStats();
        $result = $productId !== null
            ? $inventory->listForProduct($productId, $status, '', $page, 20)
            : $inventory->listAll('', $page, 20);

        foreach ($result['items'] as &$row) {
            $row['secret_masked'] = $row['secret_ciphertext'] !== '' ? $crypto->mask($crypto->decrypt($row['secret_ciphertext'])) : '';
        }

        return $this->render('admin/inventory/index', [
            'products' => $products,
            'product_id' => $productId,
            'status' => $status,
            'stats' => $stats,
            'cards' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
        ], 'admin');
    }

    public function importForm(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $products = $this->app->make('products')->listAdmin('', '', null, 1, 500)['items'];
        $products = array_values(array_filter($products, static fn ($p) => in_array($p['delivery_mode'], ['card', 'card_and_voicehub'], true)));
        return $this->render('admin/inventory/import', ['products' => $products], 'admin');
    }

    public function import(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $productId = $request->int('product_id', 0);
        $product = $this->app->make('products')->findById($productId);
        if ($product === null) {
            return $this->redirect('/admin/inventory/import')->withFlash('请选择商品。', 'error');
        }
        if (!in_array($product['delivery_mode'], ['card', 'card_and_voicehub'], true)) {
            return $this->redirect('/admin/inventory/import')->withFlash('该商品不使用库存，无法导入卡密。', 'error');
        }
        $text = $request->string('cards_text');
        $lines = preg_split('/\r\n|\r|\n/', $text) ?: [];
        $lines = array_map('trim', $lines);
        $lines = array_values(array_filter($lines, static fn ($l) => $l !== ''));

        if ($lines === []) {
            return $this->redirect('/admin/inventory/import?product=' . $productId)->withFlash('没有可导入的卡密。', 'error');
        }

        $result = $this->app->make('inventory')->import($productId, $lines, $this->app->crypto);
        $this->audit($this->adminUserId(), 'inventory.import', 'product', (string) $productId, [
            'total' => $result['total'],
            'imported' => $result['imported'],
            'duplicates' => $result['duplicates'],
            'invalid' => $result['invalid'],
        ], $request);

        $msg = sprintf('导入完成：成功 %d 条，重复 %d 条，无效 %d 条。', $result['imported'], $result['duplicates'], $result['invalid']);
        return $this->redirect('/admin/inventory?product=' . $productId)->withFlash($msg);
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
        $card = $this->app->make('inventory')->findById($id);
        if ($card === null) {
            return $this->redirect('/admin/inventory')->withFlash('卡密不存在。', 'error');
        }
        $disable = $request->string('action') === 'disable';
        $this->app->make('inventory')->setDisabled($id, $disable);
        $this->audit($this->adminUserId(), 'inventory.status', 'inventory', (string) $id, ['to' => $disable ? 'disabled' : 'available'], $request);
        return $this->redirect('/admin/inventory?product=' . $card['product_id'])->withFlash('状态已更新。');
    }
}
