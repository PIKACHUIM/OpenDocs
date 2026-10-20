import type { SqlClient } from '../db/sql';
import { randomId, sha256Hex } from '../lib/crypto';
import type { TeamMemberRecord, TeamRecord } from './types';

export interface CreateTeamInput {
  name: string;
  createdBy: string;
  quotaBytes?: number;
  allowImage?: boolean;
  allowFile?: boolean;
  maxImageBytes?: number;
  maxFileBytes?: number;
  readonly?: boolean;
  defaultCanCreate?: boolean;
  defaultCanUpdate?: boolean;
  defaultCanDelete?: boolean;
  defaultIsAdmin?: boolean;
  autoJoin?: boolean;
}

export interface UpdateTeamInput {
  name?: string;
  quotaBytes?: number;
  allowImage?: boolean;
  allowFile?: boolean;
  maxImageBytes?: number;
  maxFileBytes?: number;
  readonly?: boolean;
  defaultCanCreate?: boolean;
  defaultCanUpdate?: boolean;
  defaultCanDelete?: boolean;
  defaultIsAdmin?: boolean;
  autoJoin?: boolean;
}

const flag = (value: boolean | undefined, fallback: boolean) =>
  value === undefined ? (fallback ? 1 : 0) : value ? 1 : 0;

export function createTeamRepo(sql: SqlClient) {
  const create = async (input: CreateTeamInput): Promise<TeamRecord> => {
    const now = new Date().toISOString();
    const record: TeamRecord = {
      id: randomId('t'),
      name: input.name.trim() || '未命名团队',
      created_by: input.createdBy,
      quota_bytes: input.quotaBytes ?? 0,
      allow_image: flag(input.allowImage, true),
      allow_file: flag(input.allowFile, true),
      max_image_bytes: input.maxImageBytes ?? 0,
      max_file_bytes: input.maxFileBytes ?? 0,
      readonly: flag(input.readonly, false),
      invite_token: null,
      invite_token_hash: null,
      default_can_create: flag(input.defaultCanCreate, true),
      default_can_update: flag(input.defaultCanUpdate, true),
      default_can_delete: flag(input.defaultCanDelete, false),
      default_is_admin: flag(input.defaultIsAdmin, false),
      auto_join: flag(input.autoJoin, false),
      created_at: now,
      updated_at: now,
    };

    await sql.run(
      `INSERT INTO teams (id, name, created_by, quota_bytes, allow_image, allow_file,
        max_image_bytes, max_file_bytes, readonly, invite_token,
        default_can_create, default_can_update, default_can_delete, default_is_admin, auto_join,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.name,
        record.created_by,
        record.quota_bytes,
        record.allow_image,
        record.allow_file,
        record.max_image_bytes,
        record.max_file_bytes,
        record.readonly,
        record.default_can_create,
        record.default_can_update,
        record.default_can_delete,
        record.default_is_admin,
        record.auto_join,
        record.created_at,
        record.updated_at,
      ]
    );

    // 创建者自动成为团队管理员，且拥有全部权限
    await addMember(record.id, input.createdBy, {
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      isAdmin: true,
    });

    return record;
  };

  const getById = async (id: string): Promise<TeamRecord | null> =>
    sql.first<TeamRecord>('SELECT * FROM teams WHERE id = ?', [id]);

  const listAll = () => sql.all<TeamRecord>('SELECT * FROM teams ORDER BY created_at DESC');

  const update = async (id: string, patch: UpdateTeamInput): Promise<TeamRecord | null> => {
    const current = await getById(id);
    if (!current) return null;
    const next: TeamRecord = {
      ...current,
      name: patch.name?.trim() || current.name,
      quota_bytes: patch.quotaBytes ?? current.quota_bytes,
      allow_image: flag(patch.allowImage, !!current.allow_image),
      allow_file: flag(patch.allowFile, !!current.allow_file),
      max_image_bytes: patch.maxImageBytes ?? current.max_image_bytes,
      max_file_bytes: patch.maxFileBytes ?? current.max_file_bytes,
      readonly: flag(patch.readonly, !!current.readonly),
      default_can_create: flag(patch.defaultCanCreate, !!current.default_can_create),
      default_can_update: flag(patch.defaultCanUpdate, !!current.default_can_update),
      default_can_delete: flag(patch.defaultCanDelete, !!current.default_can_delete),
      default_is_admin: flag(patch.defaultIsAdmin, !!current.default_is_admin),
      auto_join: flag(patch.autoJoin, !!current.auto_join),
      updated_at: new Date().toISOString(),
    };
    await sql.run(
      `UPDATE teams SET name = ?, quota_bytes = ?, allow_image = ?, allow_file = ?,
        max_image_bytes = ?, max_file_bytes = ?, readonly = ?,
        default_can_create = ?, default_can_update = ?, default_can_delete = ?, default_is_admin = ?,
        auto_join = ?, updated_at = ?
       WHERE id = ?`,
      [
        next.name,
        next.quota_bytes,
        next.allow_image,
        next.allow_file,
        next.max_image_bytes,
        next.max_file_bytes,
        next.readonly,
        next.default_can_create,
        next.default_can_update,
        next.default_can_delete,
        next.default_is_admin,
        next.auto_join,
        next.updated_at,
        id,
      ]
    );
    return next;
  };

  /**
   * 生成/清空邀请令牌。
   * 数据库里只保留 SHA-256（`invite_token_hash`），明文只在生成时返回一次：
   * 之前明文存储 + 通过 /api/teams 下发给所有成员，等于把空间口令公开了。
   */
  const setInviteToken = async (id: string, token: string | null): Promise<void> => {
    await sql.run('UPDATE teams SET invite_token = NULL, invite_token_hash = ?, updated_at = ? WHERE id = ?', [
      token ? await sha256Hex(token) : null,
      new Date().toISOString(),
      id,
    ]);
  };

  const findByInviteToken = async (token: string): Promise<TeamRecord | null> => {
    if (!token) return null;
    const hashed = await sql.first<TeamRecord>(
      'SELECT * FROM teams WHERE invite_token_hash = ?',
      [await sha256Hex(token)]
    );
    if (hashed) return hashed;

    // 兼容历史数据：老库里的令牌是明文，命中后立刻迁移成哈希
    const legacy = await sql.first<TeamRecord>('SELECT * FROM teams WHERE invite_token = ?', [token]);
    if (legacy) {
      await setInviteToken(legacy.id, token);
      return { ...legacy, invite_token: null, invite_token_hash: await sha256Hex(token) };
    }
    return null;
  };

  const remove = async (id: string): Promise<void> => {
    await sql.run('DELETE FROM team_members WHERE team_id = ?', [id]);
    await sql.run('DELETE FROM teams WHERE id = ?', [id]);
  };

  // ------------------------------------------------------------------ 成员

  const addMember = async (
    teamId: string,
    userId: string,
    perms: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; isAdmin: boolean }
  ): Promise<void> => {
    const now = new Date().toISOString();
    await sql.run(
      `INSERT INTO team_members (team_id, user_id, can_create, can_update, can_delete, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_id, user_id) DO UPDATE SET
         can_create = excluded.can_create,
         can_update = excluded.can_update,
         can_delete = excluded.can_delete,
         is_admin = excluded.is_admin`,
      [
        teamId,
        userId,
        perms.canCreate ? 1 : 0,
        perms.canUpdate ? 1 : 0,
        perms.canDelete ? 1 : 0,
        perms.isAdmin ? 1 : 0,
        now,
      ]
    );
  };

  const getMember = (teamId: string, userId: string) =>
    sql.first<TeamMemberRecord>('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?', [
      teamId,
      userId,
    ]);

  const listMembers = (teamId: string) =>
    sql.all<TeamMemberRecord & { email: string; display_name: string }>(
      `SELECT m.*, u.email AS email, u.display_name AS display_name
       FROM team_members m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ? ORDER BY m.is_admin DESC, m.created_at ASC`,
      [teamId]
    );

  const removeMember = (teamId: string, userId: string) =>
    sql.run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [teamId, userId]);

  /** 删号时清理该用户在全部团队的成员关系 */
  const removeAllForUser = (userId: string) =>
    sql.run('DELETE FROM team_members WHERE user_id = ?', [userId]);

  const listByUser = (userId: string) =>
    sql.all<TeamRecord & Partial<TeamMemberRecord>>(
      `SELECT t.*, m.can_create, m.can_update, m.can_delete, m.is_admin
       FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = ? ORDER BY t.created_at ASC`,
      [userId]
    );

  const countMembers = async (teamId: string): Promise<number> => {
    const row = await sql.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?',
      [teamId]
    );
    return row?.n ?? 0;
  };

  const stats = async (teamId: string) => {
    const [members, docs] = await Promise.all([
      countMembers(teamId),
      sql.first<{ n: number; total: number }>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS total
         FROM documents WHERE team_id = ? AND deleted_at IS NULL`,
        [teamId]
      ),
    ]);
    return { memberCount: members, documentCount: docs?.n ?? 0, usedBytes: docs?.total ?? 0 };
  };

  /** 新用户注册后自动加入的团队 */
  const listAutoJoin = () => sql.all<TeamRecord>('SELECT * FROM teams WHERE auto_join = 1');

  return {
    create,
    getById,
    listAll,
    update,
    remove,
    setInviteToken,
    findByInviteToken,
    addMember,
    getMember,
    listMembers,
    removeMember,
    removeAllForUser,
    listByUser,
    countMembers,
    stats,
    listAutoJoin,
  };
}
