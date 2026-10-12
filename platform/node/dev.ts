import { createServer, type IncomingMessage } from 'node:http';
import type { ApiBindings } from '../../apps/api/src/context';
import { createApp } from '../../apps/api/src/index';
import { createDiskFileStore } from './files';
import { createSqliteClient } from './sqlite';

/**
 * 本地开发用的极简 Node HTTP 适配层：
 * 把 Hono app.fetch 桥接到 node:http，零额外依赖（不再引入 @hono/node-server）。
 * SQL 用 node:sqlite（文件持久化），文件用磁盘目录，两者都与生产驱动走同一套接口，
 * 行为差异仅限于「数据存在哪」。
 */
const sqlite = createSqliteClient(process.env.SQLITE_FILE ?? '.data/drawnix.sqlite');
const files = createDiskFileStore();

const env: ApiBindings = {
  ...(process.env as Record<string, string | undefined>),
  SQL: sqlite,
  FILES: files,
};

const app = createApp();

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function buildHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

const port = Number(process.env.PORT ?? 8788);

const server = createServer(async (req, res) => {
  try {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = `http://${req.headers.host ?? `localhost:${port}`}${req.url ?? '/'}`;
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const body = hasBody ? await readBody(req) : null;

    const request = new Request(url, {
      method,
      headers: buildHeaders(req),
      body: body && body.length > 0 ? new Uint8Array(body) : undefined,
    });

    const response = await app.fetch(request, env as never, {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
    } as never);

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('[dev-api] 未捕获异常:', error);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
});

server.listen(port, () => {
  console.log(`[dev-api] 已启动: http://localhost:${port}`);
  console.log(`[dev-api] SQLite 文件: ${process.env.SQLITE_FILE ?? '.data/drawnix.sqlite'}`);
  console.log('[dev-api] 文件存储目录: .data/files');
});
