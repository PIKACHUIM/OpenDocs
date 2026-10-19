# 架构设计

## 1. 总体形态

OpenDocs 是**前后端分离 + 纯静态前端 + 边缘函数后端**的结构：

- 前端构建产物是一组静态文件（`dist/apps/web`），不含任何 Node/SSR 运行时。
- 后端是一个 Hono 应用，运行在边缘运行时（Cloudflare Workers 或 EdgeOne Cloud Functions），
  通过薄适配层挂到 `/api/*`。
- 结构化数据存 D1（SQLite 方言），文档正文与图片等大对象存 R2 / EdgeOne Blob。

```
浏览器
  │  静态资源（HTML / JS / CSS）
  │  fetch /api/*
  ▼
边缘函数（Hono）
  ├── D1         用户 / 会话 / 文档元数据 / 目录 / 邀请码 / 设置
  └── R2 / Blob  文档正文 JSON、图片等附件
```

这样做的直接好处：

1. 静态资源走 CDN/资产层，不消耗函数调用次数（Workers 通过 `run_worker_first` 只把 `/api/*` 交给函数）。
2. 业务代码与平台解耦，同一份 `apps/api` 可以跑在 Cloudflare、EdgeOne 和本地 Node 上。
3. 没有常驻服务器，部署成本接近零。

## 2. 仓库分层

```
apps/web            React SPA：路由、页面、编辑器、设计系统
apps/api            Hono 应用：路由、仓储、服务、数据访问抽象
packages/drawnix    白板内核（上游 Drawnix，作为依赖使用）
platform/
  cloudflare/       Workers 入口（Hono + Static Assets）
  edgeone/          EdgeOne Cloud Functions 入口
  node/             本地开发：node:sqlite + 本地文件系统
migrations/         D1 迁移脚本
scripts/            构建、本地启动、端到端冒烟测试
docs/               VitePress 文档站
```

依赖方向严格单向：`apps/web → HTTP → apps/api → 平台适配层`。
`apps/api` 不感知自己跑在哪个平台。

## 3. 后端架构

### 3.1 请求生命周期

```
平台适配层
  └─ createApp()（Hono）
       ├─ CORS（同域部署时不需要）
       ├─ withRuntime      解析运行时：SQL 客户端、文件存储、仓储集合、设置服务
       │    ├─ resolveStores(env)   自动探测绑定：D1 / D1 HTTP / R2 / Blob / 内存
       │    ├─ ensureSchema(sql)    幂等建表 + 老库补列
       │    ├─ 注入 repos            users / documents / folders / invites / members / assets / settings
       │    └─ ensureAdmin(env)    按 ADMIN_EMAIL/PASSWORD 引导管理员
       ├─ 会话解析         读 Cookie → 查 sessions → 查 users → 注入 c.get('user')
       └─ 路由             /api/auth /api/documents /api/folders /api/share /api/assets /api/admin
```

### 3.2 数据访问抽象

业务层只依赖两个接口：

```ts
interface SqlClient {
  all<T>(sql, params?): Promise<T[]>
  first<T>(sql, params?): Promise<T | null>
  run(sql, params?): Promise<{ changes: number }>
  batch(statements): Promise<void>
}

interface FileStore {
  put(key, data, contentType): Promise<void>
  get(key): Promise<...>
  delete(key): Promise<void>
}
```

实现：

| 实现 | 使用场景 |
| --- | --- |
| `fromD1Binding` | Cloudflare Workers（原生绑定，`batch` 是事务性的） |
| `fromD1Http` | EdgeOne / 自建 Node（调用 Cloudflare D1 HTTP API） |
| `node:sqlite` | 本地开发与自动化测试 |
| R2 / EdgeOne Blob / 本地磁盘 / 内存 | 文件存储 |

因为都走 SQLite 方言，同一套 SQL、同一套迁移脚本可以在四种环境下复用。

### 3.3 数据模型

| 表 | 作用 | 关键字段 |
| --- | --- | --- |
| `users` | 账号 | `email` 唯一、`role`、`disabled`、PBKDF2 哈希三元组 |
| `sessions` | 会话 | `token_hash` 主键（不存明文）、`expires_at` |
| `auth_tokens` | 一次性令牌 | `purpose` 区分邮箱验证 / 找回密码 |
| `documents` | 文档元数据 | `type`、`version`（乐观锁）、`folder_id`、`starred`、`link_mode` |
| `document_members` | 协作者 | `(document_id, user_id)` 主键、`role` |
| `folders` | 多级目录 | `parent_id` 为 NULL 表示根级 |
| `invite_codes` | 邀请码 | `max_uses`、`used_count`、`expires_at`、`disabled` |
| `assets` | 附件元数据 | `file_key` 指向对象存储 |
| `settings` | 系统设置 | key/value，管理后台优先于环境变量 |

> `documents` 表刻意**不存正文**：只存 `content_key`。正文写入对象存储，避免 D1 单行 1MB 的限制
> （白板里的图片是 base64 内联的，一份画布很容易超过 1MB）。

### 3.4 并发与一致性

- **乐观锁**：保存时客户端带 `baseVersion`，服务端执行
  `UPDATE ... WHERE id = ? AND version = ?`，`changes === 0` 返回 `409`，前端提示冲突。
- **写入顺序**：先写正文对象，再更新元数据。即使元数据更新失败，也只是版本号偏旧，不会丢内容。
- **邀请码名额**：`UPDATE ... WHERE used_count < max_uses` 单语句原子扣减，并发注册不会超卖。
- **无长事务**：多语句一致性依赖 `batch`（D1 绑定下为事务），不使用跨请求事务。

### 3.5 鉴权

- 登录成功写入 HttpOnly + Secure + SameSite=Lax 的会话 Cookie，SPA 与 API 同域，无 CORS 负担。
- 数据库只存 `sha256(token)`，即使库泄漏也无法直接冒用会话。
- 文档访问权限由 `resolveDocumentAccess(document, user, memberRole)` 统一裁决，
  返回 `owner / editor / viewer / none`，路由层只做 `canWrite(access)` 判断。
- 未登录访问受保护页面时，前端整体重定向到 `/login?redirect=<原路径>`。

## 4. 前端架构

### 4.1 路由

手写极简路由（`apps/web/src/lib/router.ts`），基于 `pathname` + `pushState`，不引入 react-router：

| 路径 | 页面 | 需登录 |
| --- | --- | --- |
| `/` | 公开首页（产品导航 + 编辑器入口） | 否 |
| `/documents` | 文档管理（目录、列表/卡片、回收站） | 是 |
| `/local` | 本地白板（IndexedDB） | 否 |
| `/try/:type` | 免登录试用编辑器（本地草稿） | 否 |
| `/d/:id` | 云端文档 | 是 |
| `/s/:token` | 分享链接访问 | 否 |
| `/admin` | 管理后台 | 是（管理员） |

SPA 深链由部署层的回退规则兜底（Workers 用 `not_found_handling: single-page-application`）。

### 4.2 状态与数据流

- 全局状态只有 `AuthProvider`（当前用户、公开配置、登录/登出）。
- 页面级状态用组件内 `useState`，不引入 Redux/Zustand。
- 文档编辑通过 `useDocumentSession` 统一处理：加载 → 编辑 → 防抖保存（1.5s）→ 乐观锁 → 冲突提示。
- 免登录试用页 `LocalDraftPage` 复用同一批编辑器，只把持久化换成 localforage。

### 4.3 编辑器与代码分割

五种编辑器分别依赖重型库（Tiptap / Fortune Sheet / docx / exceljs / pptxgenjs），
全部通过 `React.lazy` + 动态 `import()` 按需加载：打开哪种文档才下载哪份代码。

### 4.4 设计系统

单一 `common.module.scss` 承载全部 UI 原子与页面级样式（CSS Modules），
不引入 UI 框架，保证视觉语言一致、可预测。详见 [设计文档](./design.md)。

## 5. 部署拓扑

| 方案 | 前端 | 后端 | 数据 |
| --- | --- | --- | --- |
| Cloudflare（推荐） | Workers Static Assets | Workers（同项目） | D1 + R2 |
| EdgeOne | EdgeOne Pages | Cloud Functions(Node) | D1 HTTP API + Blob |
| 纯静态 | 任意静态托管 | 无 | 仅浏览器本地 |

Cloudflare 侧通过 `assets.run_worker_first: ["/api/*"]` 让静态请求完全不进入 Worker，
既省调用次数也降低延迟。

## 6. 关键取舍

| 决策 | 原因 | 代价 |
| --- | --- | --- |
| D1 只存元数据，正文进对象存储 | 规避单行 1MB 限制 | 读写要两次网络往返 |
| 不使用 KV 存会话 | KV 最终一致，登出后 token 可能仍有效 60s | 会话查询走 D1 |
| 前端不引路由库 | 路由数量少、可控 | 需要自己处理 popstate |
| 单文件样式 + CSS Modules | 无构建期依赖、易审阅 | 文件较大，需靠注释分区 |
| 邀请码名额先扣减再建号 | 并发安全 | 建号失败会浪费一个名额（概率极低） |
