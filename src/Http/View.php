<?php

declare(strict_types=1);

namespace VoiceHubPay\Http;

/**
 * Server-side view renderer with layouts, partials and formatting helpers.
 */
final class View
{
    public function __construct(private readonly string $basePath)
    {
    }

    /**
     * Render a view inside a layout.
     */
    public function render(string $view, array $data = [], ?string $layout = null): string
    {
        $content = $this->partial($view, $data);
        if ($layout === null) {
            return $content;
        }
        $data['content'] = $content;
        return $this->partial('layouts/' . $layout, $data);
    }

    public function partial(string $view, array $data = []): string
    {
        extract($data, EXTR_SKIP);
        ob_start();
        require $this->basePath . '/views/' . $view . '.php';
        return (string) ob_get_clean();
    }

    public static function e(mixed $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }

    public static function money(int $cents): string
    {
        return number_format($cents / 100, 2, '.', '');
    }

    public static function moneySymbol(int $cents): string
    {
        return '¥' . self::money($cents);
    }

    public static function datetime(?string $iso, ?string $timezone = null): string
    {
        if ($iso === null || $iso === '') {
            return '-';
        }
        $tz = $timezone ?: 'Asia/Shanghai';
        try {
            $dt = new \DateTimeImmutable($iso);
            $dt = $dt->setTimezone(new \DateTimeZone($tz));
            return $dt->format('Y-m-d H:i:s');
        } catch (\Throwable) {
            return (string) $iso;
        }
    }
}
