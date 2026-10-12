#!/usr/bin/env node
/**
 * 构建 EdgeOne 部署产物：
 *
 * 1. 把 Hono 后端（含 apps/api 源码与 hono 依赖）打包为单文件
 *    cloud-functions/api/[[default]].js
 * 2. 若 dist/apps/web 已存在（先跑过 nx build web），把 cloud-functions
 *    一并复制进去，这样把 EdgeOne 的输出目录设为 dist/apps/web 也能命中函数。
 *
 * 注意：@edgeone/pages-blob 保持 external，由 EdgeOne 运行时提供；
 * 打进产物反而会因平台缺少对应底座而失败。
 */
import { build } from 'esbuild';
import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const functionsDir = path.join(root, 'cloud-functions');
const outfile = path.join(functionsDir, 'api', '[[default]].js');

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

await mkdir(path.dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'platform/edgeone/entry.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@edgeone/pages-blob'],
  charset: 'utf8',
  legalComments: 'none',
  banner: {
    js: '// 由 scripts/build-edge.mjs 生成，请勿手动修改\n// EdgeOne Cloud Functions 入口：/api/* 全部交给 Hono 处理',
  },
  metafile: true,
  logLevel: 'warning',
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`[build-edge] 已生成 ${path.relative(root, outfile)} (${(bytes / 1024).toFixed(1)} KB)`);

const staticDir = path.join(root, 'dist/apps/web');
if (await exists(staticDir)) {
  const target = path.join(staticDir, 'cloud-functions');
  await cp(functionsDir, target, { recursive: true });
  console.log(`[build-edge] 已复制函数目录到 ${path.relative(root, target)}`);
} else {
  console.log(
    '[build-edge] 跳过复制：dist/apps/web 不存在，请先执行 npm run build:web 再重新运行本脚本'
  );
}
