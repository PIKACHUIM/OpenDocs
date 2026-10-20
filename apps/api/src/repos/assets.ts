import type { SqlClient } from '../db/sql';
import { randomId } from '../lib/crypto';
import type { AssetKind, AssetRecord } from './types';

export const assetFileKey = (id: string, extensionHint?: string) =>
  `assets/${id}${extensionHint ? `.${extensionHint}` : ''}`;

export function createAssetRepo(sql: SqlClient) {
  const create = async (input: {
    documentId: string | null;
    ownerId: string | null;
    kind: AssetKind;
    contentType: string;
    sizeBytes: number;
    fileKey: string;
  }): Promise<AssetRecord> => {
    const record: AssetRecord = {
      id: randomId('a'),
      document_id: input.documentId,
      owner_id: input.ownerId,
      kind: input.kind,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
      file_key: input.fileKey,
      created_at: new Date().toISOString(),
    };
    await sql.run(
      `INSERT INTO assets (id, document_id, owner_id, kind, content_type, size_bytes, file_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.document_id,
        record.owner_id,
        record.kind,
        record.content_type,
        record.size_bytes,
        record.file_key,
        record.created_at,
      ]
    );
    return record;
  };

  const getById = (id: string) => sql.first<AssetRecord>('SELECT * FROM assets WHERE id = ?', [id]);

  const remove = (id: string) => sql.run('DELETE FROM assets WHERE id = ?', [id]);

  const listByDocument = (documentId: string) =>
    sql.all<AssetRecord>('SELECT * FROM assets WHERE document_id = ? ORDER BY created_at ASC', [documentId]);

  /** 素材库：当前用户上传过的全部图片（含文档内嵌的） */
  const listByOwner = (ownerId: string, limit = 60, offset = 0) =>
    sql.all<AssetRecord>(
      'SELECT * FROM assets WHERE owner_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [ownerId, limit, offset]
    );

  const countByOwner = async (ownerId: string): Promise<number> => {
    const row = await sql.first<{ n: number }>(
      'SELECT COUNT(*) AS n FROM assets WHERE owner_id = ?',
      [ownerId]
    );
    return row?.n ?? 0;
  };

  /** 管理端：全量附件（带所属用户邮箱） */
  const listAll = (limit = 50, offset = 0) =>
    sql.all<AssetRecord & { owner_email: string | null }>(
      `SELECT a.*, u.email AS owner_email
       FROM assets a LEFT JOIN users u ON u.id = a.owner_id
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

  const countAll = async (): Promise<number> => {
    const row = await sql.first<{ n: number }>('SELECT COUNT(*) AS n FROM assets');
    return row?.n ?? 0;
  };

  /** 无引用：绑定过文档，但该文档已被彻底删除 */
  const listUnreferenced = () =>
    sql.all<AssetRecord>(
      `SELECT * FROM assets a
       WHERE a.document_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = a.document_id)`
    );

  /** 全站已用容量，用于系统总配额校验 */
  const sumAllSize = async (): Promise<number> => {
    const row = await sql.first<{ n: number }>('SELECT SUM(size_bytes) AS n FROM assets');
    return row?.n ?? 0;
  };

  const sumSizeByOwner = async (ownerId: string): Promise<number> => {
    const row = await sql.first<{ n: number }>(
      'SELECT SUM(size_bytes) AS n FROM assets WHERE owner_id = ?',
      [ownerId]
    );
    return row?.n ?? 0;
  };

  const sumSizeByDocument = async (documentId: string): Promise<number> => {
    const row = await sql.first<{ n: number }>(
      'SELECT SUM(size_bytes) AS n FROM assets WHERE document_id = ?',
      [documentId]
    );
    return row?.n ?? 0;
  };

  /** 删号时用：该用户上传过的全部素材（含未绑定文档的） */
  const listAllByOwner = (ownerId: string) =>
    sql.all<AssetRecord>('SELECT * FROM assets WHERE owner_id = ?', [ownerId]);

  return {
    create,
    getById,
    remove,
    listByDocument,
    listByOwner,
    listAllByOwner,
    countByOwner,
    listAll,
    countAll,
    listUnreferenced,
    sumAllSize,
    sumSizeByOwner,
    sumSizeByDocument,
  };
}

export type AssetRepo = ReturnType<typeof createAssetRepo>;
