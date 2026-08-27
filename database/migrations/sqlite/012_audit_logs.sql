-- 012_audit_logs.sql (SQLite)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NULL,
    action VARCHAR(64) NOT NULL,
    object_type VARCHAR(32) NOT NULL DEFAULT '',
    object_id VARCHAR(128) NOT NULL DEFAULT '',
    ip VARCHAR(64) NOT NULL DEFAULT '',
    user_agent VARCHAR(512) NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_logs (object_type, object_id);
