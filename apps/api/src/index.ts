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

  app.onError((error) => errorResponse(error));
  app.notFound((c) => json({ error: `接口不存在: ${c.req.path}`, code: 'NOT_FOUND' }, 404));

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

  app.get('/api/health', (c) =>
    json({
      ok: true,
      storage: c.get('runtime').platform,
      time: new Date().toISOString(),
    })
  );

  app.route('/api/auth', authRoutes);
  app.route('/api/documents', documentRoutes);
  app.route('/api/folders', folderRoutes);
  app.route('/api/share', shareRoutes);
  app.route('/api/assets', assetRoutes);
  app.route('/api/admin', adminRoutes);

  return app;
}

export const app = createApp();

export default app;
