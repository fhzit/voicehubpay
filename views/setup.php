<section class="card hero">
    <div class="card-header">
        <div>
            <span class="badge"><?= $isConfigured ? '已初始化' : '首次初始化' ?></span>
            <h1><?= $isConfigured ? '系统设置' : '初始化 voicehubpay' ?></h1>
            <p class="muted">部署后无需编辑任何配置文件。OAuth2、爱发电、VoiceHub、数据库设置都会保存到 <code>storage/settings.sqlite</code>。</p>
        </div>
    </div>
    <p class="muted">OAuth 回调地址：<code><?= htmlspecialchars($oauthRedirectUri ?? ($settings['OAUTH_REDIRECT_URI'] ?? '')) ?></code></p>
</section>
<form method="post" action="/setup" class="card setup-form">
    <section class="setup-section">
        <h2>应用</h2>
        <p class="muted">首次保存会生成应用密钥；公开访问地址用于生成 OAuth 回调地址。</p>
        <div class="grid two">
            <label class="field"><span>应用 URL</span><input name="APP_URL" value="<?= htmlspecialchars($settings['APP_URL'] ?? '') ?>" placeholder="https://pay.example.com"></label>
            <label class="field"><span>应用密钥</span><input name="APP_KEY" value="<?= htmlspecialchars($settings['APP_KEY'] ?? 'generate') ?>"><small>首次可填 <code>generate</code> 自动生成。</small></label>
        </div>
    </section>

    <section class="setup-section">
        <h2>OAuth2 认证</h2>
        <p class="muted">账户系统不内置；管理员登录完全依赖这里配置的 OAuth2 Provider。请在 Provider 后台填写上方回调地址。</p>
        <label class="field"><span>Authorize URL</span><input name="OAUTH_AUTHORIZE_URL" value="<?= htmlspecialchars($settings['OAUTH_AUTHORIZE_URL'] ?? '') ?>" placeholder="https://provider.example.com/oauth/authorize"></label>
        <label class="field"><span>Token URL</span><input name="OAUTH_TOKEN_URL" value="<?= htmlspecialchars($settings['OAUTH_TOKEN_URL'] ?? '') ?>" placeholder="https://provider.example.com/oauth/token"></label>
        <label class="field"><span>UserInfo URL</span><input name="OAUTH_USERINFO_URL" value="<?= htmlspecialchars($settings['OAUTH_USERINFO_URL'] ?? '') ?>" placeholder="https://provider.example.com/oauth/userinfo"></label>
        <div class="grid two">
            <label class="field"><span>Client ID</span><input name="OAUTH_CLIENT_ID" value="<?= htmlspecialchars($settings['OAUTH_CLIENT_ID'] ?? '') ?>"></label>
            <label class="field"><span>Client Secret</span><input type="password" name="OAUTH_CLIENT_SECRET" value="<?= htmlspecialchars($settings['OAUTH_CLIENT_SECRET'] ?? '') ?>"></label>
            <label class="field"><span>Redirect URI</span><input name="OAUTH_REDIRECT_URI" value="<?= htmlspecialchars($settings['OAUTH_REDIRECT_URI'] ?? '') ?>"></label>
            <label class="field"><span>Scopes</span><input name="OAUTH_SCOPES" value="<?= htmlspecialchars($settings['OAUTH_SCOPES'] ?? '') ?>"></label>
            <label class="field"><span>Token Type</span><input name="OAUTH_TOKEN_TYPE" value="<?= htmlspecialchars($settings['OAUTH_TOKEN_TYPE'] ?? '') ?>"></label>
            <label class="field"><span>允许 OAuth 标识，逗号分隔</span><input name="OAUTH_ALLOWED_IDENTIFIERS" value="<?= htmlspecialchars($settings['OAUTH_ALLOWED_IDENTIFIERS'] ?? $settings['OAUTH_ALLOWED_EMAILS'] ?? '') ?>" placeholder="Campux 用户名 或 admin@example.com"><small>会匹配 UserInfo 返回的 <code>name</code>、<code>email</code>、<code>sub</code> 或 <code>id</code>；留空表示允许所有 OAuth 用户。</small></label>
        </div>
    </section>

    <section class="setup-section">
        <h2>数据数据库</h2>
        <p class="muted">配置库固定使用 SQLite；订单等业务数据可选择 SQLite 或 PostgreSQL。</p>
        <label class="field"><span>订单数据存储</span>
            <select name="DATA_DB_CONNECTION">
                <option value="sqlite" <?= ($settings['DATA_DB_CONNECTION'] ?? '') === 'sqlite' ? 'selected' : '' ?>>SQLite</option>
                <option value="pgsql" <?= ($settings['DATA_DB_CONNECTION'] ?? '') === 'pgsql' ? 'selected' : '' ?>>PostgreSQL</option>
            </select>
        </label>
        <label class="field"><span>SQLite 路径 / PG 数据库名</span><input name="DATA_DB_DATABASE" value="<?= htmlspecialchars($settings['DATA_DB_DATABASE'] ?? '') ?>"></label>
        <div class="grid two">
            <label class="field"><span>PG Host</span><input name="DATA_DB_HOST" value="<?= htmlspecialchars($settings['DATA_DB_HOST'] ?? '') ?>"></label>
            <label class="field"><span>PG Port</span><input name="DATA_DB_PORT" value="<?= htmlspecialchars($settings['DATA_DB_PORT'] ?? '') ?>"></label>
            <label class="field"><span>PG 用户</span><input name="DATA_DB_USERNAME" value="<?= htmlspecialchars($settings['DATA_DB_USERNAME'] ?? '') ?>"></label>
            <label class="field"><span>PG 密码</span><input type="password" name="DATA_DB_PASSWORD" value="<?= htmlspecialchars($settings['DATA_DB_PASSWORD'] ?? '') ?>"></label>
        </div>
    </section>

    <section class="setup-section">
        <h2>爱发电</h2>
        <p class="muted">Webhook 和 API 轮询共用此处凭据。</p>
        <div class="grid two">
            <label class="field"><span>User ID</span><input name="AFDIAN_USER_ID" value="<?= htmlspecialchars($settings['AFDIAN_USER_ID'] ?? '') ?>"></label>
            <label class="field"><span>API Token</span><input type="password" name="AFDIAN_API_TOKEN" value="<?= htmlspecialchars($settings['AFDIAN_API_TOKEN'] ?? '') ?>"></label>
            <label class="field"><span>API Base</span><input name="AFDIAN_API_BASE" value="<?= htmlspecialchars($settings['AFDIAN_API_BASE'] ?? '') ?>"></label>
            <label class="field"><span>订单接口</span><input name="AFDIAN_ORDER_ENDPOINT" value="<?= htmlspecialchars($settings['AFDIAN_ORDER_ENDPOINT'] ?? '') ?>"></label>
            <label class="field"><span>Webhook 签名校验</span>
                <select name="AFDIAN_WEBHOOK_REQUIRE_SIGNATURE">
                    <option value="1" <?= ($settings['AFDIAN_WEBHOOK_REQUIRE_SIGNATURE'] ?? '1') === '1' ? 'selected' : '' ?>>要求 RSA 签名</option>
                    <option value="0" <?= ($settings['AFDIAN_WEBHOOK_REQUIRE_SIGNATURE'] ?? '1') === '0' ? 'selected' : '' ?>>允许无签名旧回调</option>
                </select>
            </label>
            <label class="field"><span>轮询最多处理订单数</span><input name="AFDIAN_POLL_LIMIT" value="<?= htmlspecialchars($settings['AFDIAN_POLL_LIMIT'] ?? '') ?>"></label>
            <label class="field"><span>API 每页条数</span><input name="AFDIAN_POLL_PER_PAGE" value="<?= htmlspecialchars($settings['AFDIAN_POLL_PER_PAGE'] ?? '') ?>"></label>
        </div>
    </section>

    <section class="setup-section">
        <h2>VoiceHub</h2>
        <p class="muted">订单同步成功后会调用 VoiceHub 开放接口，将爱发电订单号导入为点歌券。</p>
        <div class="grid two">
            <label class="field"><span>API Base</span><input name="VOICEHUB_API_BASE" value="<?= htmlspecialchars($settings['VOICEHUB_API_BASE'] ?? '') ?>" placeholder="https://voicehub.example.com"></label>
            <label class="field"><span>开放接口</span><input name="VOICEHUB_TICKET_ENDPOINT" value="<?= htmlspecialchars($settings['VOICEHUB_TICKET_ENDPOINT'] ?? '') ?>"></label>
            <label class="field"><span>Open API Key</span><input type="password" name="VOICEHUB_API_TOKEN" value="<?= htmlspecialchars($settings['VOICEHUB_API_TOKEN'] ?? '') ?>"><small>使用 <code>x-api-key</code> 请求头；请求体会发送 <code>{"codes":"爱发电订单号"}</code>。</small></label>
        </div>
    </section>

    <button>保存设置并初始化</button>
</form>
