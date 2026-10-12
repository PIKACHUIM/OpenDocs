-- Drawnix 在线文档后端（D1）初始化。
-- 与 apps/api/src/db/schema.ts 的 SCHEMA_STATEMENTS 保持一致（后者在首次访问时也会
-- 幂等建表，所以忘记手动执行本文件不会直接报错，但生产环境仍建议显式执行一次）。
--
-- 应用方式：
--   npx wrangler d1 execute drawnix --local  --file=./migrations/0001_init.sql
--   npx wrangler d1 execute drawnix --remote --file=./migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS users (
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
);
CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- 邮箱验证 / 找回密码一次性令牌，purpose 区分用途
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, purpose, created_at DESC);

-- 文档元数据；type 对应五种在线编辑器：mindmap / markdown / word / excel / ppt
-- 实际内容（JSON）存在 R2/Blob，content_key 指向对应对象
CREATE TABLE IF NOT EXISTS documents (
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
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents (owner_id, deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents (updated_at DESC);

-- 指定用户分享（协作成员）
CREATE TABLE IF NOT EXISTS document_members (
  document_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  granted_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON document_members (user_id, created_at DESC);

-- 文档内嵌资源（图片等），实际文件存在 R2/Blob，file_key 指向对应对象
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  owner_id TEXT,
  kind TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_document ON assets (document_id);

-- 系统设置键值表：注册开关 / Resend / Turnstile，管理后台可改，优先于环境变量
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
