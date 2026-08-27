<?php /** @var string $active */
$__settingsItems = [
    'general' => ['基础设置', '/admin/settings/general'],
    'payment' => ['支付设置', '/admin/settings/payment'],
    'auth' => ['登录设置', '/admin/settings/auth'],
    'voicehub' => ['VoiceHub 设置', '/admin/settings/voicehub'],
    'afdian' => ['爱发电设置', '/admin/settings/afdian'],
    'security' => ['安全设置', '/admin/settings/security'],
];
foreach ($__settingsItems as $k => [$label, $url]) {
    echo '<a href="' . \VoiceHubPay\Http\View::e($url) . '"' . ($k === $active ? ' class="active"' : '') . '>' . $label . '</a>';
}
