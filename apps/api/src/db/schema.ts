import type { SqlClient } from './sql';

/**
 * 表结构。与 migrations/0001_init.sql + 0002_folders_invites.sql 保持一致。
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
    folder_id TEXT,
    starred INTEGER NOT NULL DEFAULT 0,
    last_opened_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents (owner_id, deleted_at, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents (updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents (owner_id, folder_id, deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_starred ON documents (owner_id, starred, updated_at DESC)`,

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

  // 文件夹（parent_id 为 NULL 表示根目录，支持多级）
  `CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders (owner_id, parent_id, deleted_at)`,

  // 邀请码（code 明文，管理后台需要展示/复制）
  `CREATE TABLE IF NOT EXISTS invite_codes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    max_uses INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    disabled INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes (code)`,

  // 团队空间：管理员创建，成员按权限协作
  `CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    quota_bytes INTEGER NOT NULL DEFAULT 0,
    allow_image INTEGER NOT NULL DEFAULT 1,
    allow_file INTEGER NOT NULL DEFAULT 1,
    max_image_bytes INTEGER NOT NULL DEFAULT 0,
    max_file_bytes INTEGER NOT NULL DEFAULT 0,
    readonly INTEGER NOT NULL DEFAULT 0,
    invite_token TEXT,
    invite_token_hash TEXT,
    default_can_create INTEGER NOT NULL DEFAULT 1,
    default_can_update INTEGER NOT NULL DEFAULT 1,
    default_can_delete INTEGER NOT NULL DEFAULT 0,
    default_is_admin INTEGER NOT NULL DEFAULT 0,
    auto_join INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_invite ON teams (invite_token)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_invite_hash ON teams (invite_token_hash)`,

  `CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    can_create INTEGER NOT NULL DEFAULT 1,
    can_update INTEGER NOT NULL DEFAULT 1,
    can_delete INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id, created_at DESC)`,

  // 文件夹分享：自己的目录可以分享给别人，按读/建/改/删授权
  `CREATE TABLE IF NOT EXISTS folder_members (
    folder_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    can_create INTEGER NOT NULL DEFAULT 0,
    can_read INTEGER NOT NULL DEFAULT 1,
    can_update INTEGER NOT NULL DEFAULT 0,
    can_delete INTEGER NOT NULL DEFAULT 0,
    granted_by TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (folder_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_folder_members_user ON folder_members (user_id, created_at DESC)`,
];

/**
 * 老库补列：`CREATE TABLE IF NOT EXISTS` 不会给已存在的表加字段，
 * 所以对已经跑过 0001 的库需要单独 ALTER。SQLite 没有 ADD COLUMN IF NOT EXISTS，
 * 这里逐条执行并吞掉「duplicate column」错误，保证幂等。
 */
const COLUMN_PATCHES: string[] = [
  'ALTER TABLE documents ADD COLUMN folder_id TEXT',
  'ALTER TABLE documents ADD COLUMN starred INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE documents ADD COLUMN last_opened_at TEXT',
  // 文档归属的团队空间；NULL 表示个人空间
  'ALTER TABLE documents ADD COLUMN team_id TEXT',
  // 文档级权限：查看/修改（删除只属于所有者，不开放授权）
  'ALTER TABLE document_members ADD COLUMN can_read INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE document_members ADD COLUMN can_update INTEGER NOT NULL DEFAULT 0',
  // 团队邀请令牌只存哈希（明文仅生成时返回一次）
  'ALTER TABLE teams ADD COLUMN invite_token_hash TEXT',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_invite_hash ON teams (invite_token_hash)',
];

const ready = new Map<string, Promise<void>>();

/** 每个隔离实例对每个库只建一次表；失败时清掉缓存以便下次重试 */
export function ensureSchema(sql: SqlClient): Promise<void> {
  let pending = ready.get(sql.id);
  if (!pending) {
    pending = (async () => {
      await sql.batch(SCHEMA_STATEMENTS.map((statement) => ({ sql: statement })));
      for (const patch of COLUMN_PATCHES) {
        try {
          await sql.run(patch);
        } catch {
          // 列已存在（新库走 CREATE TABLE 时就已经有了），忽略
        }
      }
    })().catch((error) => {
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
