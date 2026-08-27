<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\App;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class HomeController extends Controller
{
    public function index(Request $request): Response
    {
        $products = $this->app->make('products');
        $hot = $products->listHot(8);
        return $this->render('shop/home', ['hot' => $hot], 'shop');
    }
}
