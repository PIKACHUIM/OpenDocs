import type { SqlClient } from './sql';

/**
 * 表结构。与 migrations/0001_init.sql 保持一致。
 *
 * 注意：D1 的 exec() 只能按「每行一条语句」解析，多行的 CREATE TABLE 会解析失败，
 * 所以这里一律用 prepare + batch 逐条执行，而不是 exec。
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    disabled INTEGER NOT NULL DEFAULT 0,
    email_verified INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT,
    ip TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`,

  `CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, purpose, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content_key TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    link_mode TEXT,
    link_token TEXT,
    link_token_hash TEXT UNIQUE,
    last_edited_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents (owner_id, deleted_at, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents (updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS document_members (
    document_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    granted_by TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (document_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_members_user ON document_members (user_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    document_id TEXT,
    owner_id TEXT,
    kind TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    file_key TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_assets_document ON assets (document_id)`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

const ready = new Map<string, Promise<void>>();

/** 每个隔离实例对每个库只建一次表；失败时清掉缓存以便下次重试 */
export function ensureSchema(sql: SqlClient): Promise<void> {
  let pending = ready.get(sql.id);
  if (!pending) {
    pending = sql
      .batch(SCHEMA_STATEMENTS.map((statement) => ({ sql: statement })))
      .catch((error) => {
        ready.delete(sql.id);
        throw error;
      });
    ready.set(sql.id, pending);
  }
  return pending;
}

export function resetSchemaCache() {
  ready.clear();
}
