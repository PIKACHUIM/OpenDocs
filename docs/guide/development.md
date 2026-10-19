# 开发方式

## 环境要求

- Node.js 20+
- npm 10+
- 可选：`wrangler`（本地模拟 D1/R2）

## 仓库结构

```
apps/
  web/                React SPA（路由、页面、编辑器、设计系统）
  api/                Hono 后端（平台无关）
packages/
  drawnix/            白板内核（上游库）
platform/
  cloudflare/         Workers 入口
  edgeone/            EdgeOne 入口
  node/               本地开发：node:sqlite + 本地文件
migrations/           D1 迁移脚本
scripts/              启动、构建、冒烟测试
docs/                VitePress 文档站
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 前端开发服务器（7200） |
| `npm run dev:api` | 本地后端（8788，node:sqlite） |
| `npm run build:web` | 构建前端 |
| `npm run deploy:cf` | 构建并部署到 Cloudflare |
| `npm run build:edge` | 产出 EdgeOne 部署包 |
| `npm run test:api` | 后端端到端冒烟测试 |
| `npm run typecheck:api` | 后端类型检查 |
| `npm run docs:dev` | 文档站开发 |
| `npm run docs:build` | 构建文档站 |

## 本地开发原理

前端开发服务器把 `/api` 代理到 `http://localhost:8788`（见 `apps/web/vite.config.ts`），
因此前端代码里始终用相对路径 `/api/...`，与生产环境一致，不需要区分环境。

本地后端用 `platform/node/` 下的适配层：

- `sqlite.ts`：基于 `node:sqlite` 实现 `SqlClient`
- `files.ts`：把文件写到 `.data/` 目录

数据都落在 `.data/`（已 gitignore），删掉即清空重来。

## 后端开发

### 目录职责

```
apps/api/src/
  index.ts          组装 Hono 应用，挂载各路由
  context.ts        绑定与 Variables 类型
  middleware/       运行时注入、会话解析、requireAuth / requireAdmin
  routes/           auth / documents / folders / share / assets / admin
  repos/            数据访问（users / documents / folders / invites / ...）
  services/         settings / mail / turnstile / bootstrap
  lib/              加密、HTTP、访问控制、内容校验
  db/               SqlClient 抽象、schema
```

### 新增一个接口

1. 在 `repos/` 里加数据访问方法（只写 SQL，不掺业务判断）
2. 在 `routes/` 里加路由（做校验、鉴权、错误映射）
3. 需要鉴权就 `use('*', requireAuth)`，需要管理员就 `requireAdmin`
4. 前端在 `apps/web/src/api/index.ts` 里补一个方法

约定：

- 错误统一用 `lib/http.ts` 的 `badRequest / forbidden / notFound / conflict`，
  `onError` 会转成 `{ error, code }`
- 时间字段一律 ISO 字符串，方便跨平台排序
- 不要直接读 `process.env`，统一走 `c.env` 或 `settings` 服务

### 新增数据库字段

1. 写 `migrations/000N_xxx.sql`（`ALTER TABLE` 不幂等，只执行一次）
2. **同时**更新 `db/schema.ts` 的 `SCHEMA_STATEMENTS`，并在 `COLUMN_PATCHES` 里补一条老库补列语句
3. 更新 `repos/types.ts` 的记录类型与 DTO

> 两份 schema 必须一致：新库走 `CREATE TABLE`，老库走 `COLUMN_PATCHES`。

## 前端开发

### 路由

`apps/web/src/lib/router.ts` 是手写的极简路由，新增页面需要：

1. 在 `Route` 联合类型里加一个 kind
2. 在 `parseRoute` 里解析路径
3. 如需登录，不要加入 `PUBLIC_ROUTE_KINDS`
4. 在 `app.tsx` 的 `switch` 里加一个 case

### 样式

全部样式在 `apps/web/src/ui/common.module.scss`（CSS Modules），
顶部是设计 token（颜色、圆角、阴影），改动 token 即可全站生效。
不要引入 UI 框架，也不要写行内魔法数值——优先复用已有 class。

### 状态

- 全局只有 `AuthProvider`（用户 / 公开配置）
- 页面状态用 `useState`
- 文档编辑走 `useDocumentSession`（防抖保存 + 乐观锁）

### 编辑器

五个编辑器都在 `apps/web/src/editors/`，统一契约：

```ts
{
  canWrite: boolean
  documentId: string | null   // 上传图片时用；本地模式为 null
  shareToken: string | null
  content: <Type>Content
  onChange: (next) => void
}
```

新增编辑器时按这个契约实现，然后在 `DocumentPage` 和 `LocalDraftPage` 两处注册。

## 测试与质量

```bash
npm run typecheck:api     # 后端类型
npm run test:api          # 端到端：认证 / 文档 / 分享 / 目录 / 邀请码 / 管理员
npm run build:web         # 前端构建（也会暴露类型问题）
```

`test:api` 不依赖任何云资源，用内存/临时 SQLite 跑完整链路。

## 文档站

```bash
npm run docs:dev      # 热更新
npm run docs:build    # 产物 docs/.vitepress/dist
```

新增页面：在 `docs/` 下建 `.md`，然后在 `docs/.vitepress/config.ts` 的 `sidebar` 里登记。

## 提交约定

- 一次提交只做一件事；重构与功能分开
- 不要提交 `wrangler.jsonc`（含真实资源 ID）、`.data/`、`dist/`
- 涉及数据库的改动必须带迁移文件
