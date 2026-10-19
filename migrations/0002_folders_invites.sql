-- 0002：目录（文件夹）与邀请码注册
--
-- 应用方式：
--   npx wrangler d1 execute <db-name> --remote --file=./migrations/0002_folders_invites.sql
--
-- 注意：ALTER TABLE ADD COLUMN 不是幂等语句，本文件只需执行一次。

-- ---------------------------------------------------------------------------
-- 文件夹：parent_id 为 NULL 表示根目录，支持多级嵌套
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders (owner_id, parent_id, deleted_at);

-- ---------------------------------------------------------------------------
-- 文档增加归属目录、收藏、最近打开时间
-- ---------------------------------------------------------------------------
ALTER TABLE documents ADD COLUMN folder_id TEXT;
ALTER TABLE documents ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN last_opened_at TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents (owner_id, folder_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_documents_starred ON documents (owner_id, starred, updated_at DESC);

-- ---------------------------------------------------------------------------
-- 邀请码：一个人可创建多个码，每个码有可用次数与有效期
-- code 明文存储（管理后台需要展示与复制，本身不是登录凭证）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invite_codes (
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
);
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes (code);
