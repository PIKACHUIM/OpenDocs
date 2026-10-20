/** 统一的响应与错误处理工具 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') =>
  new HttpError(400, message, code);
export const unauthorized = (message = '请先登录', code = 'UNAUTHORIZED') =>
  new HttpError(401, message, code);
export const forbidden = (message = '没有权限执行该操作', code = 'FORBIDDEN') =>
  new HttpError(403, message, code);
export const notFound = (message = '资源不存在', code = 'NOT_FOUND') =>
  new HttpError(404, message, code);
export const conflict = (message: string, code = 'CONFLICT') => new HttpError(409, message, code);
export const tooLarge = (message: string) => new HttpError(413, message, 'PAYLOAD_TOO_LARGE');
export const tooManyRequests = (message: string) =>
  new HttpError(429, message, 'TOO_MANY_REQUESTS');

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  // 所有 JSON 接口统一禁止内容嗅探：即使某天有人把错误页/文本写进响应，
  // 浏览器也不会把它当 HTML 执行（配合 CSP 一起用）
  'X-Content-Type-Options': 'nosniff',
};

/** 请求体上限：单文档正文 8MB + JSON 信封与 base64 余量 */
export const MAX_REQUEST_BYTES = 9 * 1024 * 1024;

/**
 * 在解析 JSON / multipart 之前先按 Content-Length 拦掉超大请求，
 * 避免把整包读进内存后才在业务层报错。
 */
export function assertRequestSize(request: Request, limit = MAX_REQUEST_BYTES): void {
  const raw = request.headers.get('content-length');
  if (!raw) return;
  const length = Number.parseInt(raw, 10);
  if (Number.isFinite(length) && length > limit) throw tooLarge('请求体过大');
}

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message, code: error.code, ...error.extra }, error.status);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(message)) {
    return json({ error: '记录已存在', code: 'ALREADY_EXISTS' }, 409);
  }
  console.error('[api] 未处理异常:', error);
  return json({ error: '服务器内部错误', code: 'INTERNAL_ERROR' }, 500);
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  assertRequestSize(request);
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    throw badRequest('请求体不是合法 JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw badRequest('请求体必须是 JSON 对象');
  }
  return data as T;
}

export function requireString(
  value: unknown,
  field: string,
  options?: { min?: number; max?: number; trim?: boolean }
): string {
  if (typeof value !== 'string') throw badRequest(`缺少参数 ${field}`);
  const result = options?.trim === false ? value : value.trim();
  if (!result) throw badRequest(`参数 ${field} 不能为空`);
  if (options?.min && result.length < options.min) {
    throw badRequest(`参数 ${field} 至少 ${options.min} 个字符`);
  }
  if (options?.max && result.length > options.max) {
    throw badRequest(`参数 ${field} 最多 ${options.max} 个字符`);
  }
  return result;
}

export function optionalString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

export function requireEmail(value: unknown): string {
  const email = requireString(value, 'email', { max: 200 }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw badRequest('邮箱格式不正确');
  return email;
}

export function requirePassword(value: unknown, field = 'password'): string {
  return requireString(value, field, { min: MIN_PASSWORD_LENGTH, max: 200, trim: false });
}

export function clientIp(header: (name: string) => string | undefined): string | null {
  return (
    header('cf-connecting-ip') ??
    header('eo-connecting-ip') ??
    header('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  );
}
