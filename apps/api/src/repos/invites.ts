import type { SqlClient } from '../db/sql';
import { randomBytes, randomId } from '../lib/crypto';
import type { InviteCodeRecord } from './types';

/** 邀请码字符集：去掉 0/O/1/I 等易混字符，方便手抄与口头传播 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateInviteCode(length = 10): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return code;
}

/** 邀请码是否仍可用：未禁用、未过期、未用完 */
export function isInviteUsable(
  record: InviteCodeRecord,
  now = new Date().toISOString()
): boolean {
  if (record.disabled) return false;
  if (record.expires_at && record.expires_at <= now) return false;
  if (record.max_uses > 0 && record.used_count >= record.max_uses) return false;
  return true;
}

export function createInviteRepo(sql: SqlClient) {
  const getByCode = async (code: string): Promise<InviteCodeRecord | null> => {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return null;
    return sql.first<InviteCodeRecord>('SELECT * FROM invite_codes WHERE code = ?', [normalized]);
  };

  const getById = (id: string) =>
    sql.first<InviteCodeRecord>('SELECT * FROM invite_codes WHERE id = ?', [id]);

  const list = () =>
    sql.all<InviteCodeRecord>('SELECT * FROM invite_codes ORDER BY created_at DESC');

  const create = async (input: {
    code?: string;
    maxUses: number;
    expiresAt?: string | null;
    note?: string | null;
    createdBy?: string | null;
  }): Promise<InviteCodeRecord> => {
    const now = new Date().toISOString();
    const record: InviteCodeRecord = {
      id: randomId('inv'),
      code: input.code?.trim().toUpperCase() || generateInviteCode(),
      max_uses: input.maxUses,
      used_count: 0,
      expires_at: input.expiresAt ?? null,
      disabled: 0,
      note: input.note ?? null,
      created_by: input.createdBy ?? null,
      created_at: now,
      updated_at: now,
    };
    await sql.run(
      `INSERT INTO invite_codes
         (id, code, max_uses, used_count, expires_at, disabled, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, 0, ?, ?, ?, ?)`,
      [
        record.id,
        record.code,
        record.max_uses,
        record.expires_at,
        record.note,
        record.created_by,
        record.created_at,
        record.updated_at,
      ]
    );
    return record;
  };

  const patch = async (
    id: string,
    input: {
      disabled?: boolean;
      maxUses?: number;
      expiresAt?: string | null;
      note?: string | null;
    }
  ): Promise<InviteCodeRecord | null> => {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.disabled !== undefined) {
      sets.push('disabled = ?');
      params.push(input.disabled ? 1 : 0);
    }
    if (input.maxUses !== undefined) {
      sets.push('max_uses = ?');
      params.push(input.maxUses);
    }
    if (input.expiresAt !== undefined) {
      sets.push('expires_at = ?');
      params.push(input.expiresAt);
    }
    if (input.note !== undefined) {
      sets.push('note = ?');
      params.push(input.note);
    }
    if (sets.length === 0) return getById(id);
    sets.push('updated_at = ?');
    params.push(new Date().toISOString(), id);
    await sql.run(`UPDATE invite_codes SET ${sets.join(', ')} WHERE id = ?`, params);
    return getById(id);
  };

  const remove = (id: string) => sql.run('DELETE FROM invite_codes WHERE id = ?', [id]);

  /**
   * 原子占用一次名额：SQL 里带 `used_count < max_uses` 条件，
   * 并发注册时不会把次数用超。返回 false 表示已被抢完。
   */
  const consume = async (id: string): Promise<boolean> => {
    const result = await sql.run(
      `UPDATE invite_codes SET used_count = used_count + 1, updated_at = ?
       WHERE id = ? AND (max_uses <= 0 OR used_count < max_uses)`,
      [new Date().toISOString(), id]
    );
    return result.changes > 0;
  };

  return { getByCode, getById, list, create, patch, remove, consume };
}

export type InviteRepo = ReturnType<typeof createInviteRepo>;
