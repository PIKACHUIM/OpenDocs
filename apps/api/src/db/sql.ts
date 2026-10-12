/**
 * 极简 SQL 抽象。业务层只依赖 SqlClient，底层可以是：
 * - Cloudflare D1 绑定（生产首选）
 * - Cloudflare D1 HTTP API（EdgeOne 等非 Cloudflare 运行时也能用同一个 D1 库）
 * - node:sqlite（本地开发 / 自动化测试，见 platform/node/sqlite.ts）
 *
 * 三者都是 SQLite 方言，因此同一套 SQL 可以原样运行。
 */

export type SqlValue = string | number | null | ArrayBuffer | Uint8Array;

export interface SqlStatementInput {
  sql: string;
  params?: unknown[];
}

export interface SqlClient {
  /** 驱动类型，用于诊断展示 */
  readonly kind: string;
  /** 连接指纹，用于按库缓存「已建表」状态 */
  readonly id: string;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** D1 绑定下是事务性的；HTTP API 下为顺序执行（非原子） */
  batch(statements: SqlStatementInput[]): Promise<void>;
}

/** D1 与 node:sqlite 都不接受 undefined / boolean，这里统一归一化 */
export function normalizeParams(params: unknown[] = []): SqlValue[] {
  return params.map((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number' || typeof value === 'string') return value;
    if (typeof value === 'bigint') return Number(value);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof ArrayBuffer || value instanceof Uint8Array) return value;
    return JSON.stringify(value);
  });
}

// ---------------------------------------------------------------------------
// Cloudflare D1 绑定
// ---------------------------------------------------------------------------

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
}

export function fromD1Binding(db: D1DatabaseLike): SqlClient {
  const prepare = (sql: string, params?: unknown[]) => {
    const statement = db.prepare(sql);
    const values = normalizeParams(params);
    return values.length > 0 ? statement.bind(...values) : statement;
  };

  return {
    kind: 'd1',
    id: 'd1-binding',
    async all<T>(sql: string, params?: unknown[]) {
      const result = await prepare(sql, params).all<T>();
      return result.results ?? [];
    },
    async first<T>(sql: string, params?: unknown[]) {
      return (await prepare(sql, params).first<T>()) ?? null;
    },
    async run(sql: string, params?: unknown[]) {
      const result = await prepare(sql, params).run();
      return { changes: result.meta?.changes ?? 0 };
    },
    async batch(statements: SqlStatementInput[]) {
      if (statements.length === 0) return;
      // D1 免费版单次 batch 上限 1000 条语句，这里保守按 500 切分
      for (let index = 0; index < statements.length; index += 500) {
        await db.batch(
          statements.slice(index, index + 500).map((item) => prepare(item.sql, item.params))
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Cloudflare D1 HTTP API（给 EdgeOne / 自建 Node 等拿不到绑定的环境使用）
// ---------------------------------------------------------------------------

export interface D1HttpOptions {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

interface D1HttpResponse {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: Array<{ results?: unknown[]; meta?: { changes?: number } }>;
}

export function fromD1Http(options: D1HttpOptions): SqlClient {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/d1/database/${options.databaseId}/query`;

  const query = async (sql: string, params?: unknown[]) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params: normalizeParams(params) }),
    });
    let payload: D1HttpResponse | null = null;
    try {
      payload = (await response.json()) as D1HttpResponse;
    } catch {
      payload = null;
    }
    if (!response.ok || !payload?.success) {
      const detail = payload?.errors?.map((item) => item.message).join('; ') || `HTTP ${response.status}`;
      throw new Error(`D1 HTTP API 查询失败：${detail}`);
    }
    return payload.result?.[0] ?? { results: [], meta: {} };
  };

  return {
    kind: 'd1-http',
    id: `d1-http:${options.databaseId}`,
    async all<T>(sql: string, params?: unknown[]) {
      return ((await query(sql, params)).results ?? []) as T[];
    },
    async first<T>(sql: string, params?: unknown[]) {
      const rows = (await query(sql, params)).results ?? [];
      return (rows[0] as T | undefined) ?? null;
    },
    async run(sql: string, params?: unknown[]) {
      return { changes: (await query(sql, params)).meta?.changes ?? 0 };
    },
    async batch(statements: SqlStatementInput[]) {
      for (const item of statements) {
        await query(item.sql, item.params);
      }
    },
  };
}

/** 在 SQL 里安全拼接 LIKE 关键字 */
export function likePattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function paging(page?: unknown, pageSize?: unknown, maxSize = 100) {
  const parsedPage = Math.max(1, Number.parseInt(String(page ?? '1'), 10) || 1);
  const parsedSize = Math.min(
    maxSize,
    Math.max(1, Number.parseInt(String(pageSize ?? '20'), 10) || 20)
  );
  return { page: parsedPage, pageSize: parsedSize, offset: (parsedPage - 1) * parsedSize };
}
