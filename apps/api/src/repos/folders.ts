import type { SqlClient } from '../db/sql';
import { randomId } from '../lib/crypto';
import type { FolderRecord } from './types';

/**
 * 文件夹仓储：支持多级目录（parent_id），删除为软删除。
 * 目录只属于创建者，不参与分享（分享粒度是文档）。
 */
export function createFolderRepo(sql: SqlClient) {
  const getById = (id: string) =>
    sql.first<FolderRecord>('SELECT * FROM folders WHERE id = ?', [id]);

  const getActive = async (id: string): Promise<FolderRecord | null> => {
    const folder = await getById(id);
    return folder && !folder.deleted_at ? folder : null;
  };

  const list = (ownerId: string) =>
    sql.all<FolderRecord>(
      'SELECT * FROM folders WHERE owner_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE ASC',
      [ownerId]
    );

  const create = async (input: {
    ownerId: string;
    name: string;
    parentId?: string | null;
  }): Promise<FolderRecord> => {
    const now = new Date().toISOString();
    const record: FolderRecord = {
      id: randomId('f'),
      owner_id: input.ownerId,
      parent_id: input.parentId ?? null,
      name: input.name.trim() || '未命名文件夹',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    await sql.run(
      `INSERT INTO folders (id, owner_id, parent_id, name, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [
        record.id,
        record.owner_id,
        record.parent_id,
        record.name,
        record.created_at,
        record.updated_at,
      ]
    );
    return record;
  };

  const rename = async (id: string, name: string): Promise<FolderRecord | null> => {
    await sql.run('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?', [
      name.trim() || '未命名文件夹',
      new Date().toISOString(),
      id,
    ]);
    return getById(id);
  };

  const move = async (id: string, parentId: string | null): Promise<FolderRecord | null> => {
    await sql.run('UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?', [
      parentId,
      new Date().toISOString(),
      id,
    ]);
    return getById(id);
  };

  const softDelete = (id: string) => {
    const now = new Date().toISOString();
    return sql.run('UPDATE folders SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  };

  /** 删除目录时把子目录上提到它的父级，避免整棵子树变成孤儿 */
  const reparentChildren = (fromParentId: string, toParentId: string | null) =>
    sql.run('UPDATE folders SET parent_id = ?, updated_at = ? WHERE parent_id = ?', [
      toParentId,
      new Date().toISOString(),
      fromParentId,
    ]);

  /**
   * 判断 candidateId 是否位于 folderId 的子树中。
   * 用于阻止「把目录移动到自己或自己的子目录下」造成的环。
   */
  const isInSubtree = async (folderId: string, candidateId: string): Promise<boolean> => {
    let current: string | null = candidateId;
    const seen = new Set<string>();
    while (current) {
      if (current === folderId) return true;
      if (seen.has(current)) return false;
      seen.add(current);
      const parent = await getById(current);
      current = parent?.parent_id ?? null;
    }
    return false;
  };

  /** 删号时清理该用户自己的目录（文档已先按 owner 删除） */
  const removeAllForOwner = (ownerId: string) =>
    sql.run('DELETE FROM folders WHERE owner_id = ?', [ownerId]);

  return {
    getById,
    getActive,
    list,
    create,
    rename,
    move,
    softDelete,
    reparentChildren,
    removeAllForOwner,
    isInSubtree,
  };
}

export type FolderRepo = ReturnType<typeof createFolderRepo>;
