import { createApp } from '../../apps/api/src/index';

/**
 * EdgeOne Cloud Functions(Node) 入口源文件。
 *
 * 由 scripts/build-edge.mjs 用 esbuild 打包成
 * `cloud-functions/api/[[default]].js`，把 Hono 与业务代码内联为单文件，
 * `@edgeone/pages-blob` 保持 external 交给平台提供。
 *
 * 为什么必须是 Cloud Functions 而不是 Edge Functions：
 * 1. Edge Functions 的请求体上限只有 1MB，内嵌 base64 图片的画布很容易超
 * 2. EdgeOne 的 KV 绑定只注入 Edge Functions，Cloud Functions 拿不到，
 *    所以持久化只能走 Blob —— 这也是本驱动选择 Blob 的原因
 */
type EdgeOneContext = {
  request: Request;
  env?: Record<string, unknown>;
  waitUntil?: (task: Promise<unknown>) => void;
};

const app = createApp();

export function onRequest(context: EdgeOneContext): Response | Promise<Response> {
  return app.fetch(
    context.request,
    (context.env ?? {}) as never,
    context as never
  );
}

export default { onRequest };
