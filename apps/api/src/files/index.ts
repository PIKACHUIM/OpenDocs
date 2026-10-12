/**
 * 文件存储抽象（文档内容 JSON、图片、内嵌思维导图等二进制都走这里）。
 * - r2           : Cloudflare R2 绑定（生产首选）
 * - edgeone-blob : EdgeOne Makers Blob（EdgeOne Cloud Functions 上可用）
 * - memory       : 自动化测试
 * - 本地文件系统  : platform/node/files.ts 注入
 */
export interface FileStore {
  readonly kind: string;
  put(key: string, data: ArrayBuffer | Uint8Array | string, contentType?: string): Promise<void>;
  get(key: string): Promise<ArrayBuffer | null>;
  delete(key: string): Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBytes(data: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof data === 'string') return encoder.encode(data);
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export async function getText(files: FileStore, key: string): Promise<string | null> {
  const data = await files.get(key);
  return data ? decoder.decode(data) : null;
}

// ---------------------------------------------------------------------------
// Cloudflare R2
// ---------------------------------------------------------------------------

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
}

export function fromR2(bucket: R2BucketLike): FileStore {
  return {
    kind: 'r2',
    async put(key, data, contentType) {
      await bucket.put(key, data, {
        httpMetadata: contentType ? { contentType } : undefined,
      });
    },
    async get(key) {
      const object = await bucket.get(key);
      return object ? object.arrayBuffer() : null;
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// EdgeOne Blob
// ---------------------------------------------------------------------------

interface EdgeOneStoreLike {
  get(key: string, options?: { type?: 'arrayBuffer'; consistency?: 'strong' | 'eventual' }): Promise<unknown>;
  set(key: string, value: ArrayBuffer | string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * 变量化的模块名：`@edgeone/pages-blob` 只存在于 EdgeOne 运行时，
 * 写成字面量会让 Cloudflare 的打包器在构建期就因「无法解析模块」而失败。
 */
const EDGEONE_BLOB_MODULE = '@edgeone/pages-blob';

export async function tryEdgeOneBlob(storeName = 'drawnix'): Promise<FileStore | null> {
  try {
    const mod = (await import(EDGEONE_BLOB_MODULE)) as unknown as {
      getStore?: (name: string) => EdgeOneStoreLike;
    };
    if (typeof mod?.getStore !== 'function') return null;
    const store = mod.getStore(storeName);
    return {
      kind: 'edgeone-blob',
      async put(key, data) {
        const bytes = toBytes(data);
        // 拷贝成独立的 ArrayBuffer，避免传入共享底层缓冲区的视图
        await store.set(key, bytes.slice().buffer as ArrayBuffer);
      },
      async get(key) {
        // 文档内容写完可能立刻被另一台设备读取，必须强一致
        const value = await store.get(key, { type: 'arrayBuffer', consistency: 'strong' });
        if (!value) return null;
        if (value instanceof ArrayBuffer) return value;
        if (typeof value === 'string') return encoder.encode(value).buffer as ArrayBuffer;
        return null;
      },
      async delete(key) {
        await store.delete(key);
      },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 内存（测试）
// ---------------------------------------------------------------------------

export function createMemoryFileStore(): FileStore {
  const map = new Map<string, Uint8Array>();
  return {
    kind: 'memory',
    async put(key, data) {
      map.set(key, toBytes(data).slice());
    },
    async get(key) {
      const value = map.get(key);
      return value ? (value.slice().buffer as ArrayBuffer) : null;
    },
    async delete(key) {
      map.delete(key);
    },
  };
}
