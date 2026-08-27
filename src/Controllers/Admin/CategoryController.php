<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class CategoryController extends Controller
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
        $categories = $this->app->make('categories')->listAll();
        return $this->render('admin/categories', ['categories' => $categories], 'admin');
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
        $name = trim($request->string('name'));
        if ($name === '') {
            return $this->redirect('/admin/categories')->withFlash('分类名称不能为空。', 'error');
        }
        $categories = $this->app->make('categories');
        if ($id > 0) {
            $categories->update($id, [
                'name' => $name,
                'slug' => trim($request->string('slug')) ?: $categories->uniqueSlug($name, $id),
                'status' => $request->string('status', 'active'),
                'sort_order' => $request->int('sort_order', 0),
            ]);
            $this->audit($this->adminUserId(), 'category.update', 'category', (string) $id, ['name' => $name], $request);
            $this->flash('分类已更新。');
        } else {
            $created = $categories->create($name, $categories->uniqueSlug($name), $request->int('sort_order', 0), $request->string('status', 'active'));
            $this->audit($this->adminUserId(), 'category.create', 'category', (string) $created['id'], ['name' => $name], $request);
            $this->flash('分类已创建。');
        }
        return $this->redirect('/admin/categories');
    }

    public function delete(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $id = $request->int('id', 0);
        $ok = $this->app->make('categories')->delete($id);
        $this->audit($this->adminUserId(), 'category.delete', 'category', (string) $id, [], $request);
        return $this->redirect('/admin/categories')->withFlash($ok ? '分类已删除。' : '该分类下仍有商品，请先移除商品。', $ok ? 'success' : 'error');
    }
}
