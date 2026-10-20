import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ApiBindings, ApiEnv } from './context';
import { errorResponse, json } from './lib/http';
import { withRuntime } from './middleware';
import { adminRoutes } from './routes/admin';
import { assetRoutes } from './routes/assets';
import { authRoutes } from './routes/auth';
import { documentRoutes } from './routes/documents';
import { folderRoutes } from './routes/folders';
import { shareRoutes } from './routes/share';
import { teamRoutes } from './routes/teams';
import { userRoutes } from './routes/users';

export type { ApiBindings, ApiEnv, ApiVariables, Runtime } from './context';
export { resolveRuntime } from './runtime';

/**
 * Drawnix 在线文档后端（Hono）。
 *
 * 同一份 app 被三个平台的薄适配层复用：
 * - Cloudflare Workers       : platform/cloudflare/worker.ts（D1 + R2，与 Static Assets 同一个 Worker）
 * - EdgeOne Cloud Functions  : cloud-functions/api/[[default]].js（D1 HTTP API + Blob）
 * - 本地 Node 调试            : scripts/dev-api.mjs（node:sqlite + 本地文件系统）
 */
export function createApp() {
  const app = new Hono<ApiEnv>();

  app.onError((error) => {
    // 保留一条服务端日志：Worker 的 tail / node 控制台都能看到，便于定位 500
    console.error('[api]', error);
    return errorResponse(error);
  });
  // 不回显用户可控的 path，避免反射内容/日志注入
  app.notFound(() => json({ error: '接口不存在', code: 'NOT_FOUND' }, 404));

  // 响应后处理（注册在 cors 之前，这样它包住 cors，连 OPTIONS 预检也能处理）：
  // 1) CORS 未命中白名单时不下发 ACAC（否则等于告诉浏览器「任意来源都可带凭证」）
  // 2) 补 Referrer-Policy，避免 API 路径经 Referer 外泄到第三方
  app.use('/api/*', async (c, next) => {
    await next();
    try {
      if (!c.res.headers.get('access-control-allow-origin')) {
        c.res.headers.delete('access-control-allow-credentials');
      }
      if (!c.res.headers.get('referrer-policy')) {
        c.res.headers.set('referrer-policy', 'no-referrer');
      }
    } catch {
      // 某些运行时的 Response headers 不可变，忽略即可（不影响主流程）
    }
  });

  // 同域部署时不需要 CORS；跨域调试可用 CORS_ORIGIN 显式放行
  app.use(
    '/api/*',
    cors({
      origin: (origin, c) => {
        const raw = (c.env as ApiBindings | undefined)?.CORS_ORIGIN;
        const allowed = (raw ?? '')
          .split(',')
          .map((item: string) => item.trim())
          .filter(Boolean);
        if (allowed.length === 0) return null;
        return allowed.includes(origin) ? origin : null;
      },
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    })
  );

  app.use('*', withRuntime);

  // 健康检查只回 ok：存储后端（d1+r2 / node-sqlite+disk）属于部署内部信息
  app.get('/api/health', () => json({ ok: true }));

  app.route('/api/auth', authRoutes);
  app.route('/api/documents', documentRoutes);
  app.route('/api/folders', folderRoutes);
  app.route('/api/share', shareRoutes);
  app.route('/api/assets', assetRoutes);
  app.route('/api/teams', teamRoutes);
  app.route('/api/users', userRoutes);
  app.route('/api/admin', adminRoutes);

  return app;
}

export const app = createApp();

export default app;
