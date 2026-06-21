<?php

declare(strict_types=1);

return function (PDO $pdo): void {
    $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    $idColumn = $driver === 'pgsql' ? 'id BIGSERIAL PRIMARY KEY' : 'id INTEGER PRIMARY KEY AUTOINCREMENT';

    $pdo->exec("CREATE TABLE IF NOT EXISTS afdian_orders (
        {$idColumn},
        order_no VARCHAR(128) NOT NULL UNIQUE,
        afdian_user_id VARCHAR(128) NOT NULL DEFAULT '',
        buyer_name VARCHAR(255) NOT NULL DEFAULT '',
        amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        status VARCHAR(64) NOT NULL DEFAULT 'paid',
        voicehub_status VARCHAR(64) NOT NULL DEFAULT 'pending',
        voicehub_response TEXT NULL,
        last_error TEXT NULL,
        raw_payload TEXT NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_afdian_orders_voicehub_status ON afdian_orders (voicehub_status)');
};
