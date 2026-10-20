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
      // 只创建、不改写：以前这里会把「已存在的同名账号」直接提权并解封，
      // 一旦 ADMIN_EMAIL 误配成普通用户（甚至被攻击者抢先注册），
      // 每个请求都会把对方变成管理员，属于配置即后门。
      if (existing.role !== 'admin' || existing.disabled) {
        console.warn(
          `[api] ADMIN_EMAIL=${email} 已存在但不是可用管理员；出于安全考虑不再自动提权，请到管理后台手动处理`
        );
      }
      ensuredPerDb.add(dbKey);
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
