<?php

declare(strict_types=1);

namespace VoiceHubPay\Support;

use VoiceHubPay\Config\Config;

/**
 * Notification mail facade. Reads SMTP/notification settings via Config and
 * wraps SmtpMailer sends with scenario helpers. Gracefully no-ops when SMTP is
 * not yet configured (so the app keeps working during setup), and swallows
 * transient send failures so a notification problem never breaks a payment or
 * order request.
 */
final class Mailer
{
    private Config $config;
    private ?SmtpMailer $client = null;
    private string $lastError = '';

    public function __construct(Config $config)
    {
        $this->config = $config;
    }

    public function lastError(): string
    {
        return $this->lastError;
    }

    public function isConfigured(): bool
    {
        $host = trim((string) $this->config->get('SMTP_HOST', ''));
        $from = trim((string) $this->config->get('SMTP_FROM', ''));
        return $host !== '' && $from !== '';
    }

    public function isEnabled(): bool
    {
        return $this->isConfigured() && (int) $this->config->get('SMTP_ENABLED', '0') === 1;
    }

    private function client(): SmtpMailer
    {
        if ($this->client === null) {
            $this->client = new SmtpMailer([
                'host'       => trim((string) $this->config->get('SMTP_HOST', '')),
                'port'       => (int) $this->config->get('SMTP_PORT', '587'),
                'encryption' => trim((string) $this->config->get('SMTP_ENCRYPTION', 'tls')),
                'username'   => trim((string) $this->config->get('SMTP_USERNAME', '')),
                'password'   => trim((string) $this->config->secretStore()->get('SMTP_PASSWORD', '')),
                'from'       => trim((string) $this->config->get('SMTP_FROM', '')),
                'from_name'  => trim((string) $this->config->get('SMTP_FROM_NAME', $this->config->get('SITE_NAME', ''))),
                'timeout'    => 15,
            ]);
        }
        return $this->client;
    }

    /** Send to one address. Returns true on success; never throws. */
    public function send(string $to, string $subject, string $html, string $text = ''): bool
    {
        $this->lastError = '';
        if (!$this->isEnabled()) {
            return false;
        }
        try {
            $ok = $this->client()->send($to, $subject, $html, $text);
            return $ok;
        } catch (\Throwable $e) {
            $this->lastError = $e->getMessage();
            return false;
        }
    }

    /**
     * Send an operational notification email to the configured admin inbox.
     * Returns true on success; no-ops (false) when unconfigured or disabled.
     */
    public function notifyAdmin(string $subject, string $html, string $text = ''): bool
    {
        $admin = trim((string) $this->config->get('NOTIFY_EMAIL', ''));
        if ($admin === '') {
            $this->lastError = '未配置管理员通知邮箱 (NOTIFY_EMAIL)。';
            return false;
        }
        return $this->send($admin, $subject, $html, $text);
    }

    /** Convenience: html-escape a value inside an email template. */
    public static function esc(string $s): string
    {
        return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    }

    private function layout(string $title, string $bodyHtml): string
    {
        $site = (string) $this->config->get('SITE_NAME', '');
        return '<div style="max-width:560px;margin:0 auto;font:15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#1f2937;">'
            . '<div style="padding:16px 24px;border-bottom:1px solid #e5e7eb;"><strong style="font-size:17px;">' . self::esc($site) . '</strong></div>'
            . '<div style="padding:24px;">' . $bodyHtml . '</div>'
            . '<div style="padding:16px 24px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">此邮件由 ' . self::esc($site) . ' 系统自动发送，请勿直接回复。</div>'
            . '</div>';
    }

    /** Send a "payment success" notification to a buyer's email. */
    public function orderPaid(string $orderNo, string $itemName, string $amountYuan, string $to): bool
    {
        $site = (string) $this->config->get('SITE_NAME', '');
        $body = '<p>您好，您购买的「' . self::esc($itemName) . '」已成功支付。</p>'
            . '<p style="padding:12px 16px;background:#f3f4f6;border-radius:8px;"><b>服务号：</b>' . self::esc($orderNo)
            . '<br><b>金额：</b>¥' . self::esc($amountYuan) . '</p>'
            . '<p>权益发放后我们会再通过邮件通知您，请留意。</p>';
        $subject = '【' . $site . '】支付成功：' . $orderNo;
        return $this->send($to, $subject, $this->layout('支付成功', $body));
    }

    /** Send a "fulfillment success / benefits delivered" notification to a buyer's email. */
    public function orderFulfilled(string $orderNo, string $itemName, string $to): bool
    {
        $site = (string) $this->config->get('SITE_NAME', '');
        $body = '<p>您好，您购买的「' . self::esc($itemName) . '」权益已发放完成。</p>'
            . '<p style="padding:12px 16px;background:#f3f4f6;border-radius:8px;"><b>服务号：</b>' . self::esc($orderNo) . '</p>'
            . '<p>请登录 ' . self::esc((string) $this->config->get('SITE_URL', '')) . ' 到「我的权益」中查看并复制您的权益。</p>';
        $subject = '【' . $site . '】权益已发放：' . $orderNo;
        return $this->send($to, $subject, $this->layout('权益已发放', $body));
    }

    /** Send an admin "order received / paid" alert. */
    public function adminOrderReceived(string $orderNo, string $amountYuan, string $buyer): bool
    {
        $site = (string) $this->config->get('SITE_NAME', '');
        $body = '<p>有一笔新订单已支付：</p>'
            . '<p style="padding:12px 16px;background:#f3f4f6;border-radius:8px;"><b>服务号：</b>' . self::esc($orderNo)
            . '<br><b>金额：</b>¥' . self::esc($amountYuan)
            . '<br><b>买家：</b>' . self::esc($buyer) . '</p>';
        return $this->notifyAdmin('【' . $site . '】新订单已支付：' . $orderNo, $this->layout('新订单到账', $body));
    }

    /** Send an admin alert about an order/payment/fulfillment anomaly. */
    public function adminAlert(string $title, string $message): bool
    {
        $site = (string) $this->config->get('SITE_NAME', '');
        return $this->notifyAdmin('【' . $site . '】' . $title, $this->layout($title, '<p>' . self::esc($message) . '</p>'));
    }
}