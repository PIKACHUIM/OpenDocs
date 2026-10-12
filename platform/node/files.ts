import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileStore } from '../../apps/api/src/files';

/**
 * 本地开发用的磁盘文件存储：把 key 映射到 .data/files/ 下的文件路径。
 * 与内存驱动相比，重启进程后数据不会丢失，更接近真实部署体验。
 */
export function createDiskFileStore(root = path.resolve('.data/files')): FileStore {
  const resolve = (key: string) => {
    // 防止 key 中出现 '..' 之类的路径穿越
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
    return path.join(root, safe);
  };

  return {
    kind: 'disk',
    async put(key, data) {
      const target = resolve(key);
      await mkdir(path.dirname(target), { recursive: true });
      const bytes =
        typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data as ArrayBuffer);
      await writeFile(target, bytes);
    },
    async get(key) {
      try {
        const buffer = await readFile(resolve(key));
        return buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        ) as ArrayBuffer;
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
}
