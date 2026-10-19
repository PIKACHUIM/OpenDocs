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

  return {
    create,
    getById,
    remove,
    listByDocument,
    listByOwner,
    countByOwner,
    sumAllSize,
    sumSizeByOwner,
  };
}

export type AssetRepo = ReturnType<typeof createAssetRepo>;
