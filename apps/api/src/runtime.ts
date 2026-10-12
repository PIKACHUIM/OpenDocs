import type { ApiBindings, Runtime } from './context';
import { ensureSchema } from './db/schema';
import { fromD1Binding, fromD1Http, type SqlClient } from './db/sql';
import { fromR2, tryEdgeOneBlob, type FileStore } from './files';
import { HttpError } from './lib/http';

/**
 * 根据平台注入的绑定解析出 SQL 与文件存储。
 * 缓存按 env 对象做 WeakMap：Workers 同一隔离实例内 env 引用稳定，基本只解析一次。
 */
const cache = new WeakMap<object, Promise<Runtime>>();

function resolveSql(env: ApiBindings): SqlClient {
  if (env.SQL) return env.SQL;
  if (env.DB) return fromD1Binding(env.DB);
  if (env.D1_ACCOUNT_ID && env.D1_DATABASE_ID && env.D1_API_TOKEN) {
    return fromD1Http({
      accountId: env.D1_ACCOUNT_ID,
      databaseId: env.D1_DATABASE_ID,
      apiToken: env.D1_API_TOKEN,
    });
  }
  throw new HttpError(
    503,
    '未配置数据库：请在 wrangler.jsonc 绑定 D1（binding=DB），' +
      '或在非 Cloudflare 环境设置 D1_ACCOUNT_ID / D1_DATABASE_ID / D1_API_TOKEN 走 D1 HTTP API。',
    'DATABASE_NOT_CONFIGURED'
  );
}

async function resolveFiles(env: ApiBindings): Promise<FileStore> {
  if (env.FILES) return env.FILES;
  const driver = env.FILE_DRIVER?.trim().toLowerCase();

  if (driver !== 'edgeone-blob' && env.BUCKET) return fromR2(env.BUCKET);

  if (!driver || driver === 'edgeone-blob') {
    const blob = await tryEdgeOneBlob(env.EDGEONE_BLOB_STORE || 'drawnix');
    if (blob) return blob;
  }

  throw new HttpError(
    503,
    '未配置文件存储：请在 wrangler.jsonc 绑定 R2（binding=BUCKET）；' +
      'EdgeOne 上请部署为 Cloud Functions 以使用 Blob。',
    'FILES_NOT_CONFIGURED'
  );
}

export function resolveRuntime(env: ApiBindings): Promise<Runtime> {
  const key = env as object;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const sql = resolveSql(env);
      const files = await resolveFiles(env);
      await ensureSchema(sql);
      return { sql, files, platform: `${sql.kind}+${files.kind}` };
    })();
    // 失败不缓存，便于修好配置后无需重启即可恢复
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}
