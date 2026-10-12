import { createApp } from '../../apps/api/src/index';
import type { ApiBindings } from '../../apps/api/src/context';

/**
 * Cloudflare Workers 入口（取代原先的 Pages Functions 适配层 `functions/api/[[path]].ts`）。
 *
 * Cloudflare 官方已在 2025-04 的博客《Your frontend, backend, and database — now in
 * one Cloudflare Worker》里明确表态：新项目应直接用 Workers + Static Assets 起步，
 * Pages 不再获得新功能投入（但仍会被继续支持）。Workers 现在原生具备 Pages 当年的
 * 全部能力（`_headers`/`_redirects`、Git 集成自动构建、静态资源免费托管），并补齐了
 * Pages 缺的部分（原生绑定 D1/R2/Durable Objects 无需拆两个项目、完整可观测性、
 * 灰度发布）。本项目的业务代码（apps/api/src/**）与 Pages 时代完全一致，只是把平台
 * 适配层从 `functions/api/[[path]].ts` 换成这一个文件。
 *
 * 路由分工靠 wrangler.jsonc 的 `assets.run_worker_first: ["/api/*"]` 完成：
 * 只有 /api/* 请求会真正把这个 Worker 唤起来跑 Hono；其余所有静态资源请求
 * 完全不经过 Worker，由 Cloudflare 的资产层直接命中边缘缓存返回——不计入
 * Worker 调用次数，延迟也更低。下面的 `env.ASSETS.fetch` 分支只是防御性兜底
 * （例如未来有人把 run_worker_first 错误地改成 true），正常情况下不会被执行到。
 */
interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface WorkerEnv extends ApiBindings {
  ASSETS: AssetFetcher;
}

/**
 * 本地声明最小的 ExecutionContext 形状，避免为了一个类型就引入
 * `@cloudflare/workers-types` 整个包（项目里 Node/EdgeOne 适配层也是这个风格）。
 * 实际运行时由 workerd 注入真实对象，这里只是满足类型检查。
 */
interface MinimalExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const app = createApp();

export default {
  fetch(
    request: Request,
    env: WorkerEnv,
    ctx: MinimalExecutionContext
  ): Response | Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx as never);
    }
    return env.ASSETS.fetch(request);
  },
};
