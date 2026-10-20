import type { SqlClient } from '../db/sql';
import { randomToken, sha256Hex } from '../lib/crypto';
import type { AuthTokenPurpose, AuthTokenRecord, SessionRecord } from './types';

export const SESSION_COOKIE = 'drawnix_session';
/**
 * 会话 7 天 + 滑动续期（剩余不足一半才写库）。
 * 30 天不轮换的固定会话一旦泄露就是长期有效的凭证，缩短到 7 天并续期，
 * 既不影响日常使用，也把窗口收敛到可接受范围。
 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_PASSWORD_TTL_MS = 60 * 60 * 1000;

export function createSessionRepo(sql: SqlClient) {
  const create = async (input: {
    userId: string;
    userAgent?: string | null;
    ip?: string | null;
    ttlMs?: number;
  }) => {
    const token = randomToken(32);
    const now = Date.now();
    const record: SessionRecord = {
      token_hash: await sha256Hex(token),
      user_id: input.userId,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + (input.ttlMs ?? SESSION_TTL_MS)).toISOString(),
      user_agent: input.userAgent ?? null,
      ip: input.ip ?? null,
    };
    await sql.run(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [record.token_hash, record.user_id, record.created_at, record.expires_at, record.user_agent, record.ip]
    );
    return { token, session: record };
  };

  const getByToken = async (token: string): Promise<SessionRecord | null> => {
    if (!token) return null;
    const hash = await sha256Hex(token);
    const session = await sql.first<SessionRecord>('SELECT * FROM sessions WHERE token_hash = ?', [hash]);
    if (!session) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await sql.run('DELETE FROM sessions WHERE token_hash = ?', [hash]);
      return null;
    }
    return session;
  };

  const remove = async (token: string) => {
    if (!token) return;
    await sql.run('DELETE FROM sessions WHERE token_hash = ?', [await sha256Hex(token)]);
  };

  /** 滑动续期：把过期时间推到 now + TTL，返回新的过期时间 */
  const renew = async (token: string): Promise<string> => {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await sql.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', [
      expiresAt,
      await sha256Hex(token),
    ]);
    return expiresAt;
  };

  const removeByUser = (userId: string) =>
    sql.run('DELETE FROM sessions WHERE user_id = ?', [userId]);

  return { create, getByToken, remove, renew, removeByUser };
}

export type SessionRepo = ReturnType<typeof createSessionRepo>;

const TOKEN_TTL: Record<AuthTokenPurpose, number> = {
  verify_email: VERIFY_EMAIL_TTL_MS,
  reset_password: RESET_PASSWORD_TTL_MS,
};

/** 邮箱验证 / 找回密码一次性令牌。校验后立即标记已使用，防止重放。 */
export function createAuthTokenRepo(sql: SqlClient) {
  const issue = async (userId: string, purpose: AuthTokenPurpose) => {
    const token = randomToken(24);
    const now = Date.now();
    const record: AuthTokenRecord = {
      token_hash: await sha256Hex(token),
      user_id: userId,
      purpose,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + TOKEN_TTL[purpose]).toISOString(),
      used_at: null,
    };
    // 同类型旧令牌全部失效，避免用户邮箱里堆积多个可用链接
    await sql.run('DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ?', [userId, purpose]);
    await sql.run(
      'INSERT INTO auth_tokens (token_hash, user_id, purpose, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)',
      [record.token_hash, record.user_id, record.purpose, record.created_at, record.expires_at, record.used_at]
    );
    return { token, record };
  };

  /** 校验并立即消费；返回 userId，失败返回 null */
  const consume = async (token: string, purpose: AuthTokenPurpose): Promise<string | null> => {
    if (!token) return null;
    const hash = await sha256Hex(token);
    const record = await sql.first<AuthTokenRecord>(
      'SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ?',
      [hash, purpose]
    );
    if (!record) return null;
    if (record.used_at) return null;
    if (new Date(record.expires_at).getTime() <= Date.now()) return null;
    // 原子消费：并发重放时只有第一个 UPDATE 能命中 used_at IS NULL，
    // 避免「先读后写」被两个请求同时通过
    const consumed = await sql.run(
      'UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL',
      [new Date().toISOString(), hash]
    );
    if (consumed.changes === 0) return null;
    return record.user_id;
  };

  /** 删号时清理一次性令牌（验证/重置链接一并作废） */
  const removeByUser = (userId: string) =>
    sql.run('DELETE FROM auth_tokens WHERE user_id = ?', [userId]);

  return { issue, consume, removeByUser };
}

export type AuthTokenRepo = ReturnType<typeof createAuthTokenRepo>;
