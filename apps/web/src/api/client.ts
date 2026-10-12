export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isConflict(): boolean {
    return this.status === 409 && this.code === 'VERSION_CONFLICT';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
  body?: BodyInit | null;
}

/**
 * 统一 API 调用入口。同域部署，靠 HttpOnly Cookie 维持会话，必须带 credentials。
 * 错误统一抛 ApiError，业务侧只关心 status/code。
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, headers, body: rawBody, ...rest } = options;
  const finalHeaders = new Headers(headers);
  let body = rawBody ?? null;

  if (json !== undefined) {
    finalHeaders.set('content-type', 'application/json');
    body = JSON.stringify(json);
  }

  const response = await fetch(`/api${path}`, {
    ...rest,
    headers: finalHeaders,
    body,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') ?? '';
  let payload: unknown = null;
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  } else if (response.status !== 204) {
    payload = await response.text().catch(() => null);
  }

  if (!response.ok) {
    const detail = (payload ?? {}) as { error?: string; code?: string };
    throw new ApiError(response.status, detail.error ?? `请求失败 (${response.status})`, detail.code, payload as Record<string, unknown>);
  }

  return payload as T;
}

/** 下载二进制资源（头像预览、导出产物等），不经过 JSON 解析 */
export async function apiBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const response = await fetch(`/api${path}`, { ...options, credentials: 'include' });
  if (!response.ok) throw new ApiError(response.status, `请求失败 (${response.status})`);
  return response.blob();
}
