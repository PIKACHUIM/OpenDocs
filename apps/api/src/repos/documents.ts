import type { SqlClient } from '../db/sql';
import { randomId, randomToken, sha256Hex } from '../lib/crypto';
import { likePattern, paging } from '../db/sql';
import type { DocumentRecord, DocumentType, LinkShareMode } from './types';

/** 文档内容在文件存储里的 key；与数据库记录分离，便于直接走 R2/Blob 的大对象能力 */
export const documentContentKey = (id: string) => `documents/${id}.json`;

export function createDocumentRepo(sql: SqlClient) {
  const getById = (id: string) =>
    sql.first<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [id]);

  const getActive = async (id: string): Promise<DocumentRecord | null> => {
    const doc = await getById(id);
    return doc && !doc.deleted_at ? doc : null;
  };

  const create = async (input: {
    ownerId: string;
    type: DocumentType;
    title: string;
    sizeBytes?: number;
    /** 归属目录；不传或 null 表示未归档 */
    folderId?: string | null;
    /** 归属团队空间；不传或 null 表示个人空间 */
    teamId?: string | null;
  }): Promise<DocumentRecord> => {
    const now = new Date().toISOString();
    const record: DocumentRecord = {
      id: randomId('d'),
      owner_id: input.ownerId,
      type: input.type,
      title: input.title.trim() || '未命名文档',
      content_key: '',
      size_bytes: input.sizeBytes ?? 0,
      version: 1,
      link_mode: null,
      link_token: null,
      link_token_hash: null,
      last_edited_by: input.ownerId,
      folder_id: input.folderId ?? null,
      team_id: input.teamId ?? null,
      starred: 0,
      last_opened_at: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    record.content_key = documentContentKey(record.id);
    await sql.run(
      `INSERT INTO documents (id, owner_id, type, title, content_key, size_bytes, version,
        link_mode, link_token, link_token_hash, last_edited_by, folder_id, team_id, starred, last_opened_at,
        created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, ?, ?, ?, 0, NULL, ?, ?, NULL)`,
      [
        record.id,
        record.owner_id,
        record.type,
        record.title,
        record.content_key,
        record.size_bytes,
        record.last_edited_by,
        record.folder_id,
        record.team_id,
        record.created_at,
        record.updated_at,
      ]
    );
    return record;
  };

  /** 团队空间内的文档列表（团队内所有成员可见） */
  const listByTeam = async (
    teamId: string,
    options: { page: number; pageSize: number; query?: string; trashed?: boolean }
  ) => {
    const conditions = ['team_id = ?', options.trashed ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
    const params: unknown[] = [teamId];
    if (options.query) {
      conditions.push('title LIKE ?');
      params.push(`%${options.query}%`);
    }
    const where = conditions.join(' AND ');
    const totalRow = await sql.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM documents WHERE ${where}`,
      params
    );
    const offset = (options.page - 1) * options.pageSize;
    const items = await sql.all<DocumentRecord>(
      `SELECT * FROM documents WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [...params, options.pageSize, offset]
    );
    return {
      items,
      total: totalRow?.n ?? 0,
      page: options.page,
      pageSize: options.pageSize,
    };
  };

  /** 保存内容：乐观锁，baseVersion 不匹配时返回 conflict=true 且不写入 */
  const saveContent = async (
    id: string,
    input: { sizeBytes: number; title?: string; baseVersion?: number; editedBy: string | null }
  ): Promise<{ conflict: boolean; document: DocumentRecord | null }> => {
    const current = await getActive(id);
    if (!current) return { conflict: false, document: null };
    if (
      typeof input.baseVersion === 'number' &&
      Number.isFinite(input.baseVersion) &&
      input.baseVersion !== current.version
    ) {
      return { conflict: true, document: current };
    }
    const now = new Date().toISOString();
    await sql.run(
      `UPDATE documents SET size_bytes = ?, version = version + 1, title = ?, last_edited_by = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
      [input.sizeBytes, input.title?.trim() || current.title, input.editedBy, now, id, current.version]
    );
    const updated = await getById(id);
    return { conflict: false, document: updated };
  };

  const rename = async (id: string, title: string): Promise<DocumentRecord | null> => {
    await sql.run('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?', [
      title.trim() || '未命名文档',
      new Date().toISOString(),
      id,
    ]);
    return getById(id);
  };

  const softDelete = (id: string) =>
    sql.run('UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      new Date().toISOString(),
      new Date().toISOString(),
      id,
    ]);

  const restore = (id: string) =>
    sql.run('UPDATE documents SET deleted_at = NULL, updated_at = ? WHERE id = ?', [
      new Date().toISOString(),
      id,
    ]);

  const hardDelete = (id: string) => sql.run('DELETE FROM documents WHERE id = ?', [id]);

  /** 团队空间被删除时，把其中文档退回个人空间，避免连带删数据 */
  const detachTeam = (teamId: string) =>
    sql.run('UPDATE documents SET team_id = NULL, updated_at = ? WHERE team_id = ?', [
      new Date().toISOString(),
      teamId,
    ]);

  /** 移动到目录；folderId 为 null 表示移出到根目录 */
  const setFolder = async (id: string, folderId: string | null): Promise<DocumentRecord | null> => {
    await sql.run('UPDATE documents SET folder_id = ?, updated_at = ? WHERE id = ?', [
      folderId,
      new Date().toISOString(),
      id,
    ]);
    return getById(id);
  };

  const setStarred = async (id: string, starred: boolean): Promise<DocumentRecord | null> => {
    await sql.run('UPDATE documents SET starred = ? WHERE id = ?', [starred ? 1 : 0, id]);
    return getById(id);
  };

  /** 记录「最近打开」时间，供文档中心的「最近」分区排序 */
  const touchOpened = (id: string) =>
    sql.run('UPDATE documents SET last_opened_at = ? WHERE id = ?', [
      new Date().toISOString(),
      id,
    ]);

  /** 删除目录时把其中的文档整体挪到目标目录（通常是父目录） */
  const reassignFolder = (fromFolderId: string, toFolderId: string | null) =>
    sql.run('UPDATE documents SET folder_id = ?, updated_at = ? WHERE folder_id = ?', [
      toFolderId,
      new Date().toISOString(),
      fromFolderId,
    ]);

  const setLinkShare = async (
    id: string,
    mode: LinkShareMode
  ): Promise<{ token: string; document: DocumentRecord | null }> => {
    const token = randomToken(20);
    const tokenHash = await sha256Hex(token);
    await sql.run(
      'UPDATE documents SET link_mode = ?, link_token = ?, link_token_hash = ?, updated_at = ? WHERE id = ?',
      [mode, token, tokenHash, new Date().toISOString(), id]
    );
    return { token, document: await getById(id) };
  };

  const revokeLinkShare = async (id: string): Promise<DocumentRecord | null> => {
    await sql.run(
      'UPDATE documents SET link_mode = NULL, link_token = NULL, link_token_hash = NULL, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), id]
    );
    return getById(id);
  };

  const getByLinkToken = async (token: string): Promise<DocumentRecord | null> => {
    if (!token) return null;
    const hash = await sha256Hex(token);
    return sql.first<DocumentRecord>(
      'SELECT * FROM documents WHERE link_token_hash = ? AND deleted_at IS NULL',
      [hash]
    );
  };

  interface ListOptions {
    page: number;
    pageSize: number;
    query?: string;
    type?: DocumentType;
    trashed?: boolean;
    /** 只看某个目录：null = 未归档（根），不传 = 不限目录 */
    folderId?: string | null;
    /** 只看已收藏 */
    starred?: boolean;
    /** 按「最近打开」排序（没有打开记录时回退到更新时间） */
    recent?: boolean;
  }

  const listOwned = async (ownerId: string, options: ListOptions) => {
    const { page, pageSize, offset } = paging(options.page, options.pageSize);
    const conditions = ['owner_id = ?', options.trashed ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
    const params: unknown[] = [ownerId];
    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }
    if (options.starred) {
      conditions.push('starred = 1');
    }
    if (options.folderId !== undefined) {
      if (options.folderId === null) {
        conditions.push('folder_id IS NULL');
      } else {
        conditions.push('folder_id = ?');
        params.push(options.folderId);
      }
    }
    if (options.query) {
      conditions.push('title LIKE ?');
      params.push(likePattern(options.query));
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const orderBy = options.recent
      ? 'COALESCE(last_opened_at, updated_at) DESC'
      : 'updated_at DESC';
    const rows = await sql.all<DocumentRecord>(
      `SELECT * FROM documents ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const totalRow = await sql.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM documents ${where}`,
      params
    );
    return { items: rows, total: totalRow?.n ?? 0, page, pageSize };
  };

  /** 「与我共享」列表：通过 document_members 关联查询 */
  const listSharedWithMe = async (userId: string, options: ListOptions) => {
    const { page, pageSize, offset } = paging(options.page, options.pageSize);
    const conditions = ['m.user_id = ?', 'd.deleted_at IS NULL'];
    const params: unknown[] = [userId];
    if (options.query) {
      conditions.push('d.title LIKE ?');
      params.push(likePattern(options.query));
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await sql.all<DocumentRecord & { member_role: string }>(
      `SELECT d.*, m.role AS member_role FROM documents d
       JOIN document_members m ON m.document_id = d.id
       ${where} ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const totalRow = await sql.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM documents d JOIN document_members m ON m.document_id = d.id ${where}`,
      params
    );
    return { items: rows, total: totalRow?.n ?? 0, page, pageSize };
  };

  /**
   * 「我的分享」：我拥有、并且已经分享出去的文档
   * —— 开了链接分享，或者存在协作成员。
   */
  const listSharedByMe = async (ownerId: string, options: ListOptions) => {
    const { page, pageSize, offset } = paging(options.page, options.pageSize);
    const conditions = [
      'd.owner_id = ?',
      'd.deleted_at IS NULL',
      `(d.link_mode IS NOT NULL OR EXISTS (
         SELECT 1 FROM document_members m2 WHERE m2.document_id = d.id
       ))`,
    ];
    const params: unknown[] = [ownerId];
    if (options.query) {
      conditions.push('d.title LIKE ?');
      params.push(likePattern(options.query));
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await sql.all<
      DocumentRecord & { member_count: number; link_mode: LinkShareMode | null }
    >(
      `SELECT d.*, (SELECT COUNT(*) FROM document_members m WHERE m.document_id = d.id) AS member_count
       FROM documents d ${where} ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const totalRow = await sql.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM documents d ${where}`,
      params
    );
    return { items: rows, total: totalRow?.n ?? 0, page, pageSize };
  };

  /** 找出某个用户「最近删除」里已超过保留期的文档，供上层清理正文后彻底删除 */
  const listTrashedBefore = (ownerId: string, cutoff: string) =>
    sql.all<DocumentRecord>(
      'SELECT * FROM documents WHERE owner_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?',
      [ownerId, cutoff]
    );

  /** 管理员视角：全量文档（含已删除），可按标题 / 所有者 / 类型过滤 */
  const listAll = async (
    options: ListOptions & { ownerId?: string; includeTrashed?: boolean }
  ) => {
    const { page, pageSize, offset } = paging(options.page, options.pageSize);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!options.includeTrashed) conditions.push('deleted_at IS NULL');
    if (options.ownerId) {
      conditions.push('owner_id = ?');
      params.push(options.ownerId);
    }
    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }
    if (options.query) {
      conditions.push('(title LIKE ? OR id LIKE ?)');
      params.push(likePattern(options.query), likePattern(options.query));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await sql.all<DocumentRecord>(
      `SELECT * FROM documents ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const totalRow = await sql.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM documents ${where}`,
      params
    );
    return { items: rows, total: totalRow?.n ?? 0, page, pageSize };
  };

  const countByOwner = async (ownerId: string): Promise<number> => {
    const row = await sql.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM documents WHERE owner_id = ? AND deleted_at IS NULL',
      [ownerId]
    );
    return row?.n ?? 0;
  };

  const stats = async () => {
    const totals = await sql.first<{ total: number; trashed: number; shared: number; bytes: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS trashed,
              SUM(CASE WHEN link_mode IS NOT NULL THEN 1 ELSE 0 END) AS shared,
              SUM(size_bytes) AS bytes
       FROM documents`
    );
    const byType = await sql.all<{ type: DocumentType; n: number }>(
      "SELECT type, COUNT(*) AS n FROM documents WHERE deleted_at IS NULL GROUP BY type"
    );
    return {
      total: totals?.total ?? 0,
      trashed: totals?.trashed ?? 0,
      shared: totals?.shared ?? 0,
      storageBytes: totals?.bytes ?? 0,
      byType,
    };
  };

  return {
    getById,
    getActive,
    create,
    saveContent,
    rename,
    softDelete,
    restore,
    hardDelete,
    detachTeam,
    setFolder,
    setStarred,
    touchOpened,
    reassignFolder,
    setLinkShare,
    revokeLinkShare,
    getByLinkToken,
    listOwned,
    listByTeam,
    listSharedWithMe,
    listSharedByMe,
    listTrashedBefore,
    listAll,
    countByOwner,
    stats,
  };
}

export type DocumentRepo = ReturnType<typeof createDocumentRepo>;
