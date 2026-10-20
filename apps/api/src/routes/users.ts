import { Hono } from 'hono';
import type { ApiEnv } from '../context';
import { clientIp, json } from '../lib/http';
import { RATE_LIMITS, enforceRateLimit } from '../lib/rate-limit';
import { requireAuth } from '../middleware';

/**
 * 站内用户检索：给「添加成员 / 分享」的用户选择器用。
 *
 * 只暴露最小字段（id / 邮箱 / 昵称），不返回角色、状态等管理信息；
 * 需要登录才能调用，且有频率限制，避免被当成通讯录爬取。
 */
export const userRoutes = new Hono<ApiEnv>();
userRoutes.use('*', requireAuth);

userRoutes.get('/search', async (c) => {
  enforceRateLimit(
    `user-search:${c.get('user')!.id}:${clientIp((name) => c.req.header(name)) ?? 'unknown'}`,
    RATE_LIMITS.userSearch
  );
  const keyword = (c.req.query('q') ?? '').trim();
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, limitRaw)) : 10;

  const rows = keyword
    ? await c.get('repos').users.search(keyword, limit)
    : await c.get('repos').users.listRecent(Math.min(limit, 10));

  return json({
    users: rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
    })),
  });
});
