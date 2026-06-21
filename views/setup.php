<section class="card">
    <h1><?= $isConfigured ? '系统设置' : '初始化 voicehubpay' ?></h1>
    <p class="muted">配置会保存到 <code>storage/settings.sqlite</code>。账户不内置，后台认证仍使用 OAuth2。</p>
</section>
<form method="post" action="/setup" class="card setup-form">
    <h2>应用</h2>
    <label>应用 URL<input name="APP_URL" value="<?= htmlspecialchars($settings['APP_URL'] ?? '') ?>"></label>
    <label>应用密钥<input name="APP_KEY" value="<?= htmlspecialchars($settings['APP_KEY'] ?? 'generate') ?>"><small>首次可填 <code>generate</code> 自动生成。</small></label>

    <h2>数据数据库</h2>
    <label>订单数据存储
        <select name="DATA_DB_CONNECTION">
            <option value="sqlite" <?= ($settings['DATA_DB_CONNECTION'] ?? '') === 'sqlite' ? 'selected' : '' ?>>SQLite</option>
            <option value="pgsql" <?= ($settings['DATA_DB_CONNECTION'] ?? '') === 'pgsql' ? 'selected' : '' ?>>PostgreSQL</option>
        </select>
    </label>
    <label>SQLite 路径 / PG 数据库名<input name="DATA_DB_DATABASE" value="<?= htmlspecialchars($settings['DATA_DB_DATABASE'] ?? '') ?>"></label>
    <div class="grid two">
        <label>PG Host<input name="DATA_DB_HOST" value="<?= htmlspecialchars($settings['DATA_DB_HOST'] ?? '') ?>"></label>
        <label>PG Port<input name="DATA_DB_PORT" value="<?= htmlspecialchars($settings['DATA_DB_PORT'] ?? '') ?>"></label>
        <label>PG 用户<input name="DATA_DB_USERNAME" value="<?= htmlspecialchars($settings['DATA_DB_USERNAME'] ?? '') ?>"></label>
        <label>PG 密码<input type="password" name="DATA_DB_PASSWORD" value="<?= htmlspecialchars($settings['DATA_DB_PASSWORD'] ?? '') ?>"></label>
    </div>

    <h2>OAuth2</h2>
    <label>Authorize URL<input name="OAUTH_AUTHORIZE_URL" value="<?= htmlspecialchars($settings['OAUTH_AUTHORIZE_URL'] ?? '') ?>"></label>
    <label>Token URL<input name="OAUTH_TOKEN_URL" value="<?= htmlspecialchars($settings['OAUTH_TOKEN_URL'] ?? '') ?>"></label>
    <label>UserInfo URL<input name="OAUTH_USERINFO_URL" value="<?= htmlspecialchars($settings['OAUTH_USERINFO_URL'] ?? '') ?>"></label>
    <div class="grid two">
        <label>Client ID<input name="OAUTH_CLIENT_ID" value="<?= htmlspecialchars($settings['OAUTH_CLIENT_ID'] ?? '') ?>"></label>
        <label>Client Secret<input type="password" name="OAUTH_CLIENT_SECRET" value="<?= htmlspecialchars($settings['OAUTH_CLIENT_SECRET'] ?? '') ?>"></label>
        <label>Redirect URI<input name="OAUTH_REDIRECT_URI" value="<?= htmlspecialchars($settings['OAUTH_REDIRECT_URI'] ?? '') ?>"></label>
        <label>Scopes<input name="OAUTH_SCOPES" value="<?= htmlspecialchars($settings['OAUTH_SCOPES'] ?? '') ?>"></label>
        <label>Token Type<input name="OAUTH_TOKEN_TYPE" value="<?= htmlspecialchars($settings['OAUTH_TOKEN_TYPE'] ?? '') ?>"></label>
        <label>允许邮箱，逗号分隔<input name="OAUTH_ALLOWED_EMAILS" value="<?= htmlspecialchars($settings['OAUTH_ALLOWED_EMAILS'] ?? '') ?>"></label>
    </div>

    <h2>爱发电</h2>
    <div class="grid two">
        <label>User ID<input name="AFDIAN_USER_ID" value="<?= htmlspecialchars($settings['AFDIAN_USER_ID'] ?? '') ?>"></label>
        <label>API Token<input type="password" name="AFDIAN_API_TOKEN" value="<?= htmlspecialchars($settings['AFDIAN_API_TOKEN'] ?? '') ?>"></label>
        <label>API Base<input name="AFDIAN_API_BASE" value="<?= htmlspecialchars($settings['AFDIAN_API_BASE'] ?? '') ?>"></label>
        <label>订单接口<input name="AFDIAN_ORDER_ENDPOINT" value="<?= htmlspecialchars($settings['AFDIAN_ORDER_ENDPOINT'] ?? '') ?>"></label>
        <label>Webhook Secret<input type="password" name="AFDIAN_WEBHOOK_SECRET" value="<?= htmlspecialchars($settings['AFDIAN_WEBHOOK_SECRET'] ?? '') ?>"></label>
        <label>轮询条数<input name="AFDIAN_POLL_LIMIT" value="<?= htmlspecialchars($settings['AFDIAN_POLL_LIMIT'] ?? '') ?>"></label>
    </div>

    <h2>VoiceHub</h2>
    <div class="grid two">
        <label>API Base<input name="VOICEHUB_API_BASE" value="<?= htmlspecialchars($settings['VOICEHUB_API_BASE'] ?? '') ?>"></label>
        <label>点歌券接口<input name="VOICEHUB_TICKET_ENDPOINT" value="<?= htmlspecialchars($settings['VOICEHUB_TICKET_ENDPOINT'] ?? '') ?>"></label>
        <label>API Token<input type="password" name="VOICEHUB_API_TOKEN" value="<?= htmlspecialchars($settings['VOICEHUB_API_TOKEN'] ?? '') ?>"></label>
        <label>Auth Scheme<input name="VOICEHUB_AUTH_SCHEME" value="<?= htmlspecialchars($settings['VOICEHUB_AUTH_SCHEME'] ?? '') ?>"></label>
    </div>

    <button>保存设置并初始化</button>
</form>
