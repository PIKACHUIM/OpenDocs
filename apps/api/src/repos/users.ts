import type { SqlClient } from '../db/sql';
import { randomId, type PasswordHash } from '../lib/crypto';
import type { UserRecord, UserRole } from './types';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** lib/crypto 的 PasswordHash（hash/salt/iterations）与 DB 列名（password_*）之间的映射 */
const toColumns = (password: PasswordHash) => ({
  password_hash: password.hash,
  password_salt: password.salt,
  password_iterations: password.iterations,
});

export function createUserRepo(sql: SqlClient) {
  const getById = (id: string) =>
    sql.first<UserRecord>('SELECT * FROM users WHERE id = ?', [id]);

  const getByEmail = (email: string) =>
    sql.first<UserRecord>('SELECT * FROM users WHERE email = ?', [normalizeEmail(email)]);

  const create = async (input: {
    email: string;
    displayName?: string;
    role?: UserRole;
    emailVerified?: boolean;
    password: PasswordHash;
  }): Promise<UserRecord> => {
    const now = new Date().toISOString();
    const email = normalizeEmail(input.email);
    const passwordColumns = toColumns(input.password);
    const record: UserRecord = {
      id: randomId('u'),
      email,
      display_name: input.displayName?.trim() || email.split('@')[0],
      role: input.role ?? 'user',
      disabled: 0,
      email_verified: input.emailVerified ? 1 : 0,
      ...passwordColumns,
      created_at: now,
      updated_at: now,
      last_login_at: null,
    };
    await sql.run(
      `INSERT INTO users (id, email, display_name, role, disabled, email_verified,
         password_hash, password_salt, password_iterations, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.email,
        record.display_name,
        record.role,
        record.disabled,
        record.email_verified,
        record.password_hash,
        record.password_salt,
        record.password_iterations,
        record.created_at,
        record.updated_at,
        record.last_login_at,
      ]
    );
    return record;
  };

  const update = async (
    id: string,
    patch: Partial<{
      displayName: string;
      role: UserRole;
      disabled: boolean;
      emailVerified: boolean;
      password: PasswordHash;
      lastLoginAt: string;
    }>
  ): Promise<UserRecord | null> => {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.displayName !== undefined) {
      sets.push('display_name = ?');
      params.push(patch.displayName);
    }
    if (patch.role !== undefined) {
      sets.push('role = ?');
      params.push(patch.role);
    }
    if (patch.disabled !== undefined) {
      sets.push('disabled = ?');
      params.push(patch.disabled ? 1 : 0);
    }
    if (patch.emailVerified !== undefined) {
      sets.push('email_verified = ?');
      params.push(patch.emailVerified ? 1 : 0);
    }
    if (patch.password !== undefined) {
      const columns = toColumns(patch.password);
      sets.push('password_hash = ?', 'password_salt = ?', 'password_iterations = ?');
      params.push(columns.password_hash, columns.password_salt, columns.password_iterations);
    }
    if (patch.lastLoginAt !== undefined) {
      sets.push('last_login_at = ?');
      params.push(patch.lastLoginAt);
    }
    if (sets.length === 0) return getById(id);
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    await sql.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    return getById(id);
  };

  const remove = (id: string) => sql.run('DELETE FROM users WHERE id = ?', [id]);

  const countAdmins = async (): Promise<number> => {
    const row = await sql.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0"
    );
    return row?.n ?? 0;
  };

  const count = async (): Promise<number> => {
    const row = await sql.first<{ n: number }>('SELECT COUNT(*) AS n FROM users');
    return row?.n ?? 0;
  };

  const list = async (options: { page: number; pageSize: number; query?: string }) => {
    const offset = (options.page - 1) * options.pageSize;
    const where = options.query ? 'WHERE email LIKE ? OR display_name LIKE ? OR id LIKE ?' : '';
    const likeValue = options.query ? `%${options.query}%` : null;
    const params = options.query ? [likeValue, likeValue, likeValue] : [];

    const rows = await sql.all<UserRecord>(
      `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, options.pageSize, offset]
    );
    const totalRow = await sql.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM users ${where}`,
      params
    );
    return { items: rows, total: totalRow?.n ?? 0 };
  };

  return { getById, getByEmail, create, update, remove, countAdmins, count, list };
}

export type UserRepo = ReturnType<typeof createUserRepo>;
