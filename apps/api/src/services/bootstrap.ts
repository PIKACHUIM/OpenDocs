import type { ApiBindings } from '../context';
import { hashPassword } from '../lib/crypto';
import type { UserRepo } from '../repos/users';

const ensuredPerDb = new WeakSet<object>();

/**
 * 用 ADMIN_EMAIL / ADMIN_PASSWORD 引导管理员账号。
 * 按「数据库连接对象」记一次标志而不是全局标志，避免测试里多个内存库互相串标志位。
 */
export async function ensureAdmin(env: ApiBindings, users: UserRepo, dbKey: object): Promise<void> {
  if (ensuredPerDb.has(dbKey)) return;
  const email = env.ADMIN_EMAIL?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 8) {
    ensuredPerDb.add(dbKey);
    return;
  }

  try {
    const existing = await users.getByEmail(email);
    if (existing) {
      if (existing.role !== 'admin' || existing.disabled) {
        await users.update(existing.id, { role: 'admin', disabled: false });
        console.log(`[api] 已将 ${email} 提升为管理员`);
      }
    } else {
      await users.create({
        email,
        password: await hashPassword(password),
        displayName: 'Administrator',
        role: 'admin',
        emailVerified: true,
      });
      console.log(`[api] 已创建管理员账号 ${email}`);
    }
    ensuredPerDb.add(dbKey);
  } catch (error) {
    console.error('[api] 管理员引导失败:', error);
    // 不置位，下次请求再试一次
  }
}
