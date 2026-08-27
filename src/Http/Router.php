<?php

declare(strict_types=1);

namespace VoiceHubPay\Http;

/**
 * Minimal pattern router.
 *
 * Routes use {param} placeholders, e.g. "/orders/{orderNo}".
 * Route handlers are callables of shape fn(Request $request, array $params): Response.
 */
final class Router
{
    /** @var array<string, array<int, array{pattern:string, handler:callable}>> */
    private array $routes = ['GET' => [], 'POST' => [], 'ANY' => []];

    public function get(string $path, callable $handler): void
    {
        $this->routes['GET'][] = ['pattern' => $path, 'handler' => $handler];
    }

    public function post(string $path, callable $handler): void
    {
        $this->routes['POST'][] = ['pattern' => $path, 'handler' => $handler];
    }

    public function any(string $path, callable $handler): void
    {
        $this->routes['ANY'][] = ['pattern' => $path, 'handler' => $handler];
    }

    /**
     * Dispatch request; returns the response or null when no route matched.
     */
    public function dispatch(Request $request): ?Response
    {
        $method = $request->method();
        $path = rtrim($request->path(), '/') ?: '/';
        $candidates = array_merge($this->routes[$method] ?? [], $this->routes['ANY'] ?? []);
        foreach ($candidates as $route) {
            $params = $this->match($route['pattern'], $path);
            if ($params !== null) {
                $handler = $route['handler'];
                return $handler($request, $params);
            }
        }
        return null;
    }

    private function match(string $pattern, string $path): ?array
    {
        $pattern = rtrim($pattern, '/') ?: '/';
        $patternParts = explode('/', $pattern);
        $pathParts = explode('/', $path);
        if (count($patternParts) !== count($pathParts)) {
            return null;
        }
        $params = [];
        foreach ($patternParts as $i => $part) {
            if (str_starts_with($part, '{') && str_ends_with($part, '}')) {
                $name = substr($part, 1, -1);
                $params[$name] = rawurldecode((string) $pathParts[$i]);
            } elseif ($part !== $pathParts[$i]) {
                return null;
            }
        }
        return $params;
    }
}
