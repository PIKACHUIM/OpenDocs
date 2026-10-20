import type { SqlClient } from '../db/sql';
import type {
  DocumentMemberRecord,
  DocumentMemberRole,
  FolderMemberRecord,
  PermissionSet,
} from './types';

/**
 * 文档「指定用户分享」成员表。
 *
 * 权限模型：读 / 改可单独授予；删除始终只属于所有者，
 * 因此这里不提供 can_delete 的授权入口（表里也不留该列）。
 * role 字段保留用于兼容旧数据：editor → 可读可改，viewer → 只读。
 */
export function createMemberRepo(sql: SqlClient) {
  const upsert = async (input: {
    documentId: string;
    userId: string;
    role: DocumentMemberRole;
    grantedBy: string | null;
    canRead?: boolean;
    canUpdate?: boolean;
  }): Promise<DocumentMemberRecord> => {
    const now = new Date().toISOString();
    const canRead = input.canRead ?? true;
    const canUpdate = input.canUpdate ?? input.role === 'editor';
    // 改了权限就同步 role，避免两套字段互相矛盾
    const role: DocumentMemberRole = canUpdate ? 'editor' : 'viewer';

    await sql.run(
      `INSERT INTO document_members (document_id, user_id, role, can_read, can_update, granted_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (document_id, user_id) DO UPDATE SET
         role = excluded.role,
         can_read = excluded.can_read,
         can_update = excluded.can_update`,
      [input.documentId, input.userId, role, canRead ? 1 : 0, canUpdate ? 1 : 0, input.grantedBy, now]
    );

    return {
      document_id: input.documentId,
      user_id: input.userId,
      role,
      can_read: canRead ? 1 : 0,
      can_update: canUpdate ? 1 : 0,
      granted_by: input.grantedBy,
      created_at: now,
    };
  };

  const remove = (documentId: string, userId: string) =>
    sql.run('DELETE FROM document_members WHERE document_id = ? AND user_id = ?', [
      documentId,
      userId,
    ]);

  const removeAllForDocument = (documentId: string) =>
    sql.run('DELETE FROM document_members WHERE document_id = ?', [documentId]);

  /** 旧接口：只取角色 */
  const getRole = async (
    documentId: string,
    userId: string
  ): Promise<DocumentMemberRole | null> => {
    const row = await sql.first<{ role: DocumentMemberRole }>(
      'SELECT role FROM document_members WHERE document_id = ? AND user_id = ?',
      [documentId, userId]
    );
    return row?.role ?? null;
  };

  /** 新接口：取完整权限 */
  const getPermissions = async (
    documentId: string,
    userId: string
  ): Promise<PermissionSet | null> => {
    const row = await sql.first<DocumentMemberRecord>(
      'SELECT * FROM document_members WHERE document_id = ? AND user_id = ?',
      [documentId, userId]
    );
    if (!row) return null;
    const canUpdate = !!row.can_update || row.role === 'editor';
    return {
      canCreate: false,
      canRead: !!row.can_read || canUpdate,
      canUpdate,
      // 删除只属于所有者
      canDelete: false,
    };
  };

  const listByDocument = (documentId: string) =>
    sql.all<DocumentMemberRecord & { email: string; display_name: string }>(
      `SELECT m.*, u.email, u.display_name FROM document_members m
       JOIN users u ON u.id = m.user_id WHERE m.document_id = ? ORDER BY m.created_at ASC`,
      [documentId]
    );

  return { upsert, remove, removeAllForDocument, getRole, getPermissions, listByDocument };
}

/** 文件夹分享授权 */
export function createFolderMemberRepo(sql: SqlClient) {
  const upsert = async (input: {
    folderId: string;
    userId: string;
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    grantedBy: string | null;
  }) => {
    const now = new Date().toISOString();
    await sql.run(
      `INSERT INTO folder_members (folder_id, user_id, can_create, can_read, can_update, can_delete, granted_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (folder_id, user_id) DO UPDATE SET
         can_create = excluded.can_create,
         can_read = excluded.can_read,
         can_update = excluded.can_update,
         can_delete = excluded.can_delete`,
      [
        input.folderId,
        input.userId,
        input.canCreate ? 1 : 0,
        input.canRead ? 1 : 0,
        input.canUpdate ? 1 : 0,
        input.canDelete ? 1 : 0,
        input.grantedBy,
        now,
      ]
    );
  };

  const get = (folderId: string, userId: string) =>
    sql.first<FolderMemberRecord>(
      'SELECT * FROM folder_members WHERE folder_id = ? AND user_id = ?',
      [folderId, userId]
    );

  const listByFolder = (folderId: string) =>
    sql.all<FolderMemberRecord & { email: string; display_name: string }>(
      `SELECT f.*, u.email, u.display_name FROM folder_members f
       JOIN users u ON u.id = f.user_id WHERE f.folder_id = ? ORDER BY f.created_at ASC`,
      [folderId]
    );

  const remove = (folderId: string, userId: string) =>
    sql.run('DELETE FROM folder_members WHERE folder_id = ? AND user_id = ?', [folderId, userId]);

  const removeAllForFolder = (folderId: string) =>
    sql.run('DELETE FROM folder_members WHERE folder_id = ?', [folderId]);

  /** 别人分享给我的目录（附带目录本身的信息） */
  const listSharedWithUser = (userId: string) =>
    sql.all<
      FolderMemberRecord & {
        name: string;
        parent_id: string | null;
        owner_id: string;
        updated_at: string;
      }
    >(
      `SELECT f.*, fo.name, fo.parent_id, fo.owner_id, fo.updated_at
       FROM folder_members f JOIN folders fo ON fo.id = f.folder_id
       WHERE f.user_id = ? AND fo.deleted_at IS NULL
       ORDER BY fo.updated_at DESC`,
      [userId]
    );

  return { upsert, get, listByFolder, remove, removeAllForFolder, listSharedWithUser };
}

export type MemberRepo = ReturnType<typeof createMemberRepo>;
export type FolderMemberRepo = ReturnType<typeof createFolderMemberRepo>;
