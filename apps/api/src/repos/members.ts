import type { SqlClient } from '../db/sql';
import type { DocumentMemberRecord, DocumentMemberRole } from './types';

/** 文档的「指定用户分享」成员表 */
export function createMemberRepo(sql: SqlClient) {
  const upsert = async (input: {
    documentId: string;
    userId: string;
    role: DocumentMemberRole;
    grantedBy: string | null;
  }): Promise<DocumentMemberRecord> => {
    const now = new Date().toISOString();
    await sql.run(
      `INSERT INTO document_members (document_id, user_id, role, granted_by, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`,
      [input.documentId, input.userId, input.role, input.grantedBy, now]
    );
    return { document_id: input.documentId, user_id: input.userId, role: input.role, granted_by: input.grantedBy, created_at: now };
  };

  const remove = (documentId: string, userId: string) =>
    sql.run('DELETE FROM document_members WHERE document_id = ? AND user_id = ?', [documentId, userId]);

  const removeAllForDocument = (documentId: string) =>
    sql.run('DELETE FROM document_members WHERE document_id = ?', [documentId]);

  const getRole = async (documentId: string, userId: string): Promise<DocumentMemberRole | null> => {
    const row = await sql.first<{ role: DocumentMemberRole }>(
      'SELECT role FROM document_members WHERE document_id = ? AND user_id = ?',
      [documentId, userId]
    );
    return row?.role ?? null;
  };

  const listByDocument = (documentId: string) =>
    sql.all<DocumentMemberRecord & { email: string; display_name: string }>(
      `SELECT m.*, u.email, u.display_name FROM document_members m
       JOIN users u ON u.id = m.user_id WHERE m.document_id = ? ORDER BY m.created_at ASC`,
      [documentId]
    );

  return { upsert, remove, removeAllForDocument, getRole, listByDocument };
}

export type MemberRepo = ReturnType<typeof createMemberRepo>;
