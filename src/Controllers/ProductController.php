<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\App;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Repositories\InventoryRepository;
use VoiceHubPay\Shop\ShopService;

final class ProductController extends Controller
{
    public function index(Request $request): Response
    {
        $categories = $this->app->make('categories')->listActive();
        $filters = [
            'category_id' => $request->int('category', 0) ?: null,
            'q' => $request->string('q'),
            'sort' => $request->string('sort', 'recommend'),
        ];
        $page = max(1, $request->int('page', 1));
        $result = $this->app->make('products')->listPublic($filters, $page, 12);
        return $this->render('shop/products', [
            'categories' => $categories,
            'products' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
            'filters' => $filters,
        ], 'shop');
    }

    public function show(Request $request, array $params): Response
    {
        $slug = (string) ($params['slug'] ?? '');
        $product = $this->app->make('products')->findBySlug($slug);
        if ($product === null || $product['status'] === 'disabled') {
            return $this->app->make('controllers.error')->notFound($request);
        }
        if ($product['status'] === 'draft') {
            return $this->app->make('controllers.error')->notFound($request);
        }

        $inventory = new InventoryRepository($this->app);
        $product['stock_available'] = $inventory->countAvailable((int) $product['id']);
        $product['stock_reserved'] = $inventory->countByStatus((int) $product['id'], 'reserved');
        $shop = new ShopService($this->app);
        $product['max_purchasable'] = $shop->maxPurchasable($product);

        return $this->render('shop/product-detail', ['product' => $product], 'shop');
    }
}
