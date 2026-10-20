-- 安全加固：团队邀请令牌改为只存哈希
--
-- 背景：invite_token 之前是明文，且通过 GET /api/teams 下发给了所有成员，
-- 任何成员都能拿到空间口令并拉人（若默认新成员为管理员，还能直接提权）。
-- 现在数据库只保留 SHA-256，明文仅在「生成/重置」响应里出现一次。
--
-- 老数据兼容：旧明文令牌仍可用（findByInviteToken 命中后会自动迁移为哈希），
-- 建议管理员在升级后到「团队空间」里重置一次邀请链接。

ALTER TABLE teams ADD COLUMN invite_token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_invite_hash ON teams (invite_token_hash);
