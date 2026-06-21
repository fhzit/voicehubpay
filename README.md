# voicehubpay

`voicehubpay` is a small native PHP bridge that syncs Afdian orders into VoiceHub song-ticket creation requests.

## Features

- Afdian order ingestion through both webhook and API polling.
- VoiceHub API dispatch with retryable order status tracking.
- Setup and runtime configuration from Web UI; no manual config-file editing required.
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

Open `http://127.0.0.1:8080/setup` and complete the initialization form. The form saves OAuth2, Afdian, VoiceHub, and data-database settings into `storage/settings.sqlite`.

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

Cron example:

```cron
*/5 * * * * cd /path/to/voicehubpay && php scripts/poll-afdian.php >> storage/logs/poll.log 2>&1
```

## Afdian webhook

Configure Afdian to send order webhooks to:

```text
POST https://your-domain.example.com/webhook/afdian
```

The webhook handler validates the configured Afdian webhook secret when Afdian sends a signature header. If your Afdian webhook format differs, update `AfdianService::verifyWebhook()` and `AfdianService::normalizeWebhookOrder()`.

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
