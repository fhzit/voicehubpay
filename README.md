# voicehubpay

`voicehubpay` is a small native PHP bridge that syncs Afdian orders into VoiceHub song-ticket creation requests.

## Features

- Afdian order ingestion through both webhook and API polling.
- VoiceHub API dispatch with retryable order status tracking.
- SQLite and PostgreSQL database support via PDO.
- OAuth2-only admin authentication; no built-in account/password system.
- Minimal Web UI for configuration visibility, order status, and manual sync/retry.

## Requirements

- PHP 8.2+
- PDO driver for SQLite or PostgreSQL
- cURL extension
- Composer is optional for future dependencies; current code has a small PSR-4 autoloader fallback.

## Quick start

```bash
cp .env.example .env
php scripts/migrate.php
php -S 127.0.0.1:8080 -t public
```

Open `http://127.0.0.1:8080` and sign in through your OAuth2 provider.

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

The webhook handler validates `AFDIAN_WEBHOOK_SECRET` when Afdian sends a signature header. If your Afdian webhook format differs, update `AfdianService::verifyWebhook()` and `AfdianService::normalizeWebhookOrder()`.

## VoiceHub payload

By default, `VoiceHubService` posts JSON to `VOICEHUB_API_BASE + VOICEHUB_TICKET_ENDPOINT`:

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
