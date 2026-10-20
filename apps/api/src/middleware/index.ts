import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { ApiEnv } from '../context';
import { forbidden, unauthorized } from '../lib/http';
import { createRepositories } from '../repos';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../repos/sessions';
import { resolveRuntime } from '../runtime';
import { ensureAdmin } from '../services/bootstrap';
import { createSettingsService } from '../services/settings';

/** 支持 Cookie（浏览器）与 Bearer（脚本/API 调用）两种传参方式 */
export function readSessionToken(c: {
  req: { header: (name: string) => string | undefined };
}): string | null {
  const authorization = c.req.header('authorization');
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return match[1].trim();
  }
  return null;
}

/** 初始化运行时、仓储并解析当前登录用户；不拦截，未登录也继续往下走 */
export const withRuntime: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const runtime = await resolveRuntime(c.env);
  const repos = createRepositories(runtime.sql);

  c.set('runtime', runtime);
  c.set('repos', repos);
  c.set('settings', createSettingsService(repos.settings, c.env));

  // 用 sql 客户端对象本身当缓存键，保证同一个库只引导一次管理员
  await ensureAdmin(c.env, repos.users, runtime.sql as unknown as object);

  const token = readSessionToken(c) ?? getCookie(c, SESSION_COOKIE) ?? null;
  c.set('sessionToken', token);
  // 必须先兜底为 null：否则 token 无效时 Variables 里会残留上一次请求的脏值
  c.set('user', null);

  if (token) {
    const session = await repos.sessions.getByToken(token);
    if (session) {
      const user = await repos.users.getById(session.user_id);
      if (user && !user.disabled) {
        c.set('user', user);
        // 滑动续期：剩余不足一半时才写库，避免每个请求都 UPDATE
        const remaining = new Date(session.expires_at).getTime() - Date.now();
        if (remaining < SESSION_TTL_MS / 2) {
          const renewTask = repos.sessions.renew(token).catch(() => undefined);
          try {
            // Workers/EdgeOne 都注入 ExecutionContext；本地适配层没有时直接让它异步跑完
            c.executionCtx.waitUntil(renewTask);
          } catch {
            // 忽略：请求结束时 promise 仍会继续执行
          }
        }
      }
    }
  }

  await next();
};

export const requireAuth: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (!c.get('user')) throw unauthorized();
  await next();
};

export const requireAdmin: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user) throw unauthorized();
  if (user.role !== 'admin') throw forbidden('仅管理员可访问');
  await next();
};
