# voicehubpay

`voicehubpay` is a small native PHP bridge that syncs Afdian orders into VoiceHub song-ticket creation requests.

## Features

- Afdian order ingestion through both webhook and API polling.
- VoiceHub API dispatch with retryable order status tracking.
- Setup and runtime configuration from Web UI; no manual config-file editing required.
- shadcn-inspired Web UI using design tokens, cards, buttons, badges, and form controls.
- Configuration is always stored in `storage/settings.sqlite`.
- Order/data storage can use SQLite or PostgreSQL via PDO.
- OAuth2-only admin authentication; no built-in account/password system.

## Requirements

- PHP 8.2+
- PDO SQLite driver for the settings database
- PDO SQLite or PDO PostgreSQL driver for order data
- cURL extension
- Composer is optional; current code has a small PSR-4 autoloader fallback.

## Quick start

```bash
php -S 127.0.0.1:8080 -t public
```

Open `http://127.0.0.1:8080/setup` and complete the initialization form. Do not edit config files during deployment: the form saves OAuth2, Afdian, VoiceHub, and data-database settings into `storage/settings.sqlite`.

OAuth2 is configured in the same first-run form. Copy the displayed callback URL into your OAuth provider, then paste the provider's authorize/token/userinfo URLs and client credentials back into Web UI.

The first setup request is unauthenticated so a fresh install can be configured. After setup is complete, `/setup` requires OAuth2 login.

## Storage model

- `storage/settings.sqlite`: fixed SQLite database for application configuration.
- `DATA_DB_CONNECTION=sqlite`: stores order data in the configured SQLite file, default `storage/voicehubpay.sqlite`.
- `DATA_DB_CONNECTION=pgsql`: stores order data in PostgreSQL using the host, port, database, username, and password configured in Web UI.

## Polling

Run manually:

```bash
php scripts/poll-afdian.php
```

The poller calls `https://ifdian.net/api/open/query-order` by default and signs requests as `md5(token + sorted key/value payload)` according to Afdian's OpenAPI documentation.

Cron example:

```cron
*/5 * * * * cd /path/to/voicehubpay && php scripts/poll-afdian.php >> storage/logs/poll.log 2>&1
```

## Afdian webhook

Configure Afdian to send order webhooks to:

```text
POST https://your-domain.example.com/webhook/afdian
```

The webhook handler verifies Afdian's RSA signature by default. Afdian signs `out_trade_no + user_id + plan_id + total_amount` with SHA256, and the handler responds with the required JSON shape:

```json
{"ec":200,"em":""}
```

If you need to accept legacy unsigned callbacks temporarily, set `Webhook 签名校验` to `允许无签名旧回调` in Web UI.

## VoiceHub payload

By default, `VoiceHubService` posts JSON to configured `VOICEHUB_API_BASE + VOICEHUB_TICKET_ENDPOINT`:

```json
{
  "source": "afdian",
  "order_no": "...",
  "user_id": "...",
  "amount": 1,
  "metadata": { "...": "..." }
}
```

Adjust `src/Services/VoiceHubService.php` if the live VoiceHub API contract uses different field names.
