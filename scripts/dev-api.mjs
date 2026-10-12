#!/usr/bin/env node
/**
 * 本地启动后端：用 esbuild 打包 platform/node/dev.ts 后直接运行。
 * 只依赖项目已有的 esbuild，不额外引入 ts-node / tsx。
 *
 * 用法：
 *   npm run dev:api
 *   PORT=8788 SQLITE_FILE=.data/drawnix.sqlite npm run dev:api
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const outfile = path.resolve('dist/dev-api.mjs');

await build({
  entryPoints: [path.resolve('platform/node/dev.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // 保持依赖外部化，本地直接走 node_modules
  packages: 'external',
  sourcemap: true,
  logLevel: 'warning',
});

await import(pathToFileURL(outfile).href);
