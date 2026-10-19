# OpenDocs 部署指南

> 这是本仓库的详细部署笔记；文档站里有结构更清晰的版本：[部署方式](./docs/guide/deploy.md)。

OpenDocs 的前端产物是**纯静态**的（`dist/apps/web`），后端是一个 Hono 应用，
可以被 Cloudflare Workers（Static Assets）承载，也可以被 EdgeOne Cloud Functions 承载。

因此有三种部署形态，按需选择：

| 形态 | 说明 | 需要后端吗 |
| --- | --- | --- |
| A. 纯静态 | 只托管 `dist/apps/web`，`/local` 的本地白板存在浏览器 IndexedDB | 不需要 |
| B. Cloudflare Workers + D1 + R2 | 账号体系 + 文档管理（白板/Markdown/Word/Excel/PPT）+ 目录 + 分享协作 + 管理后台 | 需要 |
| C. EdgeOne Pages + D1(HTTP API) + Blob | 同上，面向国内访问 | 需要 |

三种形态的前端是同一份产物：**没有后端时首页与 `/local` 仍可用**，
`/documents`、`/d/:id`、`/admin` 等云端功能会因接口不可用而报错。

> **为什么是 Workers 而不是 Pages？** Cloudflare 官方在 2025-04 的博客
> 《Your frontend, backend, and database — now in one Cloudflare Worker》里明确表态：
> *"Now that Workers supports both serving static assets and server-side rendering,
> you should start with Workers."* Pages 仍会被继续支持，但"所有新功能、优化和投入资源
> 都转向 Workers"，实质上已经功能冻结。Workers 现在原生具备 Pages 当年的全部能力
> （`_headers`/`_redirects`、Git 集成自动构建、静态资源免费托管），并且补齐了 Pages
> 欠缺的部分：D1/R2 等绑定可以直接挂在同一个 Worker 上（不用像 Pages 那样为了用
> Durable Objects 之类的能力被迫拆成两个项目）、完整的 Workers Observability、
> 按流量灰度发布。计费模型两者一致（纯静态资源免费托管，只有 Worker 代码真正执行时才计费），
> 迁移不会带来额外成本。本项目的业务代码（`apps/api/src/**`）在 Pages 和 Workers 下完全一致，
> 只是平台适配层不同：现在用的是 `platform/cloudflare/worker.ts`。

---

## A. 纯静态部署（最简）

### Cloudflare Workers（只托管静态资源，不部署后端）

1. 打开 https://dash.cloudflare.com/workers-and-pages → **Create** → **Deploy a site**（或用 CLI）
2. 最简单的方式是直接用 CLI：

   ```bash
   npm run build:web
   npx wrangler deploy --assets=dist/apps/web --name=drawnix-static
   ```

   这样部署的是一个纯静态 Worker，不会跑任何后端逻辑。

> 如果你想连后端一起部署但暂时不想配置 D1/R2，直接看下面的方案 B——
> 没有绑定时 `/api/*` 会返回 503，前端的云端页面会提示错误，但 `/` 的本地白板不受影响。

---

## B. Cloudflare Workers + D1 + R2（推荐）

**D1 和 R2 都是必需绑定**：D1 存结构化数据（用户/会话/文档元数据/系统设置），
R2 存文档内容本体与图片等大对象（思维导图/Word 的 JSON、上传的图片）。两者分工明确，
不存在"没有 R2 就退化"的说法——没有 R2 文档内容就没地方存。

### 1. 创建资源

```bash
npx wrangler d1 create drawnix
# 记下输出的 database_id，填入 wrangler.jsonc 的 d1_databases[].database_id

npx wrangler r2 bucket create drawnix-files

# 初始化表结构（驱动首次访问也会自动幂等建表，但生产环境建议显式执行一次）
npx wrangler d1 execute drawnix --remote --file=./migrations/0001_init.sql
```

### 2. 部署

```bash
npm run deploy:cf
```

这个脚本等价于 `nx build web && npx wrangler deploy`：先产出静态站点到
`dist/apps/web`（`wrangler.jsonc` 里 `assets.directory` 指向这里），再用
`wrangler deploy` 把 `platform/cloudflare/worker.ts`（挂载 Hono 后端）与静态资源
一起发布成一个 Worker。

也可以走 Git 集成（Workers Builds）：Dashboard → Workers & Pages → Create →
Connect to Git，Build command 填 `npm run build:web`，Cloudflare 会读取仓库根的
`wrangler.jsonc` 完成构建与绑定。

### 3. 配置管理员

在 Worker 的 **Settings → Variables and Secrets** 中添加（建议用 Secret 而非普通变量）：

| 名称 | 说明 |
| --- | --- |
| `ADMIN_EMAIL` | 管理员邮箱，首次请求时自动创建/提升该账号 |
| `ADMIN_PASSWORD` | 管理员密码（≥8 位） |

也可以先不配置，改为把 `BOOTSTRAP_FIRST_ADMIN` 设为 `true`（默认即为 `true`），
让**第一个注册的账号**成为管理员，注册完成后建议改回 `false` 并在管理后台里调整。

> ⚠️ `wrangler deploy` / 平台重新部署会用 `wrangler.jsonc` 的 `vars` **覆盖控制台里同名的普通变量**。
> 需要长期保留或保密的值（密码、Resend API Key、Turnstile Secret）请放进 **Secret**：
> ```bash
> npx wrangler secret put ADMIN_PASSWORD
> npx wrangler secret put RESEND_API_KEY
> npx wrangler secret put TURNSTILE_SECRET_KEY
> ```
> 这些密钥也可以不配环境变量，改在**管理后台「系统设置」**里直接填写（存 D1，优先级高于环境变量）。

### 4. 静态资源不消耗 Worker 调用次数

`wrangler.jsonc` 里的 `assets.run_worker_first` 已经把 Worker 限定在 `/api/*`：

```jsonc
"assets": {
  "directory": "./dist/apps/web",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"]
}
```

其余所有静态资源请求完全不经过 Worker，由 Cloudflare 的资产层直接命中边缘缓存返回——
不计入 Worker 调用次数（免费版 10 万次/天），延迟也更低。`not_found_handling:
"single-page-application"` 则是 SPA 深链（`/d/<id>`、`/s/<token>` 等）回退到
`index.html` 的原生机制。

> ⚠️ **不要再加 `_redirects` 做 SPA 回退**：曾经加过 `/* /index.html 200`，
> 结果 `wrangler deploy` 直接报错 `Invalid _redirects configuration: Infinite loop
> detected`（code 100324）。原因是这条"代理"规则会和 `html_handling`（默认
> `auto-trailing-slash`）的路径归一化互相触发——归一化会把 `/index.html` 这种
> URL 尝试剥离后缀重定向回 `/`，而 `/` 又命中 `/* ...` 规则再次代理到
> `/index.html`，形成死循环，被 Wrangler 的校验直接拦截。`not_found_handling`
> 走的是另一条内部兜底逻辑，不经过 `_redirects`/`html_handling` 的归一化，
> 两者**不能共存**，所以项目里已经删除了 `apps/web/public/_redirects`，
> 只保留 `wrangler.jsonc` 的 `not_found_handling` 这一种实现。

---

## C. EdgeOne Pages + D1(HTTP API) + Blob

### 为什么是这个组合

- **EdgeOne 没有 D1**，但 Cloudflare D1 提供 **HTTP API**，任何运行时都能通过 `fetch` 直接查询，
  所以 EdgeOne 上的数据库依然是 Cloudflare D1，只是不走原生绑定，走 HTTP API（见下方环境变量）。
- EdgeOne 的 **KV 只注入 Edge Functions**，Cloud Functions 拿不到；而 Edge Functions 请求体上限只有
  1MB、CPU 200ms，Word/Excel 文档的内容很容易超过，所以后端必须部署为 **Cloud Functions(Node)**。
- 文件存储用 **EdgeOne Blob**（Cloud Functions 可用，单值上限 25MB）。

### 1. 控制台创建项目

从 Git 关联仓库，填写：

```
Build command: npm run build:edge
Output directory: dist/apps/web
```

`npm run build:edge` 会做两件事：

1. `nx build web` 产出静态站点
2. `scripts/build-edge.mjs` 用 esbuild 把 Hono 后端打包成单文件
   `cloud-functions/api/[[default]].js`，并复制一份到 `dist/apps/web/cloud-functions/`
   （这样无论平台以"项目根"还是"输出目录"作为函数基准目录都能命中）

### 2. 环境变量：D1 HTTP API

在 EdgeOne 项目设置里添加：

| 名称 | 说明 |
| --- | --- |
| `D1_ACCOUNT_ID` | Cloudflare 账户 ID |
| `D1_DATABASE_ID` | D1 数据库 ID（同 B 方案创建的那个库） |
| `D1_API_TOKEN` | 有 D1 编辑权限的 Cloudflare API Token |

后端会用这三个变量通过 `https://api.cloudflare.com/.../d1/database/.../query` 读写同一个 D1 库，
与 Cloudflare Workers 共用数据没有问题（两边各自的请求延迟不同，但数据是同一份）。

### 3. 文件存储：Blob 零配置

无需任何配置：后端首次访问时会调用 `getStore('drawnix')`，EdgeOne 会**自动创建**同名的 Blob
命名空间。若想换名字，设置环境变量 `EDGEONE_BLOB_STORE=<你的命名空间>`。

> 免费版的 Blob 额度是**单账户 1GB**。Word/Excel 里的图片会让占用增长较快。

### 4. SPA 深链回退（重要）

Cloudflare Workers 侧由 `wrangler.jsonc` 的 `assets.not_found_handling:
"single-page-application"` 处理（项目里**没有** `_redirects` 文件——曾经加过
`/* /index.html 200` 做同样的事，结果与这个配置项冲突导致部署失败，详见方案 B
第 4 节）；而 **EdgeOne 既不认 `_redirects` 也没有等价配置项**，所以
`/documents`、`/d/<id>`、`/s/<token>`、`/admin` 这类深链直接输入地址打开会拿到 404。
两种处理方式：

1. 在 EdgeOne 控制台的项目设置里开启 SPA / 单页应用回退（未命中的路径回退到 `index.html`）
2. 或新增 `cloud-functions/[[default]].js` 作为兜底（EdgeOne 的静态资源优先级高于函数，
   所以不会影响正常资源，只会接住未命中的路径）：

````js
// cloud-functions/[[default]].js —— 非 /api 的未命中路径回退到 SPA 入口
export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = '/index.html';
  url.search = '';
  try {
    const response = await fetch(url.toString());
    return new Response(await response.text(), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  } catch {
    return new Response('SPA 回退失败，请检查静态资源与函数路由配置', { status: 502 });
  }
}
````

> `/api/*` 会被更具体的 `cloud-functions/api/[[default]].js` 优先匹配，不受影响。

### 5. 其它环境变量

| 名称 | 说明 |
| --- | --- |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 引导管理员账号 |
| `BOOTSTRAP_FIRST_ADMIN` | 默认 `true`：首个注册者成为管理员 |
| `ALLOW_REGISTRATION` | `false` 时关闭公开注册（管理后台也能改） |
| `RESEND_API_KEY` / `RESEND_FROM` | 邮件发送（管理后台也能改） |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 人机验证（管理后台也能改） |

---

## 本地开发

```bash
# 1. 启动后端（默认 http://localhost:8788）
npm run dev:api

# 2. 另开一个终端启动前端（Vite 已把 /api 代理到 8788）
npm run start
```

本地后端用 `node:sqlite` + 磁盘目录做持久化（数据在 `.data/`，已加入 `.gitignore`），
重启进程不会丢数据；删掉 `.data/` 目录即可清空重来。

想用真实 D1/R2 本地调试，可改用 wrangler（需要先完成方案 B 的第 1 步）：

```bash
npm run build:web
npx wrangler dev
```

`wrangler dev` 默认连本地模拟的 D1/R2（`--local`，Miniflare），加 `--remote`
则会连真实的远程资源（行为更接近生产环境，但会消耗真实额度）。

后端接口的端到端自测（不需要任何云资源）：

```bash
npm run test:api      # 覆盖认证/文档 CRUD/链接分享/指定用户分享/附件/管理员/系统设置
npm run typecheck:api
```

---

## 接口与权限速览

| 能力 | 接口 | 权限 |
| --- | --- | --- |
| 注册 / 登录 / 登出 / 改密 / 找回密码 / 验证邮箱 | `/api/auth/*` | 公开（找回/重置/验证需要邮件里的一次性 token） |
| 我的文档 / 与我共享 / 回收站 | `GET /api/documents?scope=owned\|shared&trashed=` | 需登录 |
| 创建 / 读取 / 保存 / 重命名 / 复制 / 删除 / 恢复 | `/api/documents/:id` | 所有者 / 管理员 / 协作成员（按角色）/ 分享 edit |
| 链接分享（开启/撤销） | `POST` `DELETE /api/documents/:id/share-link` | 所有者或管理员 |
| 指定用户分享（协作成员增删改查） | `/api/documents/:id/members*` | 所有者或管理员 |
| 通过链接访问（无需登录） | `GET` `PUT /api/share/:token` | 公开；`PUT` 仅在 `mode=edit` 时可用 |
| 把分享文档认领为我的协作文档 | `POST /api/share/:token/claim` | 需登录 |
| 上传/下载/删除图片等附件 | `/api/assets*` | 按所属文档的权限或分享 token |
| 管理后台（用户/文档/系统设置） | `/api/admin/*` | 仅管理员 |

**「分享给未登录用户也能编辑」是怎么实现的**：
所有者把链接分享模式设为 `edit` 后，任何拿到链接的人都能通过 `PUT /api/share/:token`
直接保存，无需注册。`view` 模式则前端以只读方式加载，后端也会拒绝写入。
**「分享给指定用户」** 走的是另一条路径（`document_members` 表）：所有者填对方的注册邮箱
+ 角色（viewer/editor），对方登录后在"与我共享"里能看到并按角色访问。

---

## 已知注意事项

1. **请求体上限**：Cloudflare Workers 与 EdgeOne Edge/Cloud Functions 都有硬限制，
   业务层在 `apps/api/src/lib/document-content.ts` 里设了 8MB 闸门并给出可读提示。
2. **`_headers` 只对静态资产响应生效**：命中 `/api/*`（即 Worker 代码本身）的请求不会经过
   `_headers`，响应头需要在代码里设置（`apps/api/src/lib/http.ts` 的 `json()` 已带
   `Cache-Control: no-store`）。`_redirects` 同理，且**重定向规则先于 `_headers` 执行**。
   上线后建议用 `curl -I https://你的域名/`、`/d/xxx`、`/assets/xxx.js` 三类路径核对
   实际响应头，确认 HTML 不会被长期缓存（见 `apps/web/public/_headers`）。
3. **R2 / D1 都需要在控制台走一次开通流程**（免费额度内不产生费用），具体是否要求绑定支付方式
   请以控制台实际提示为准。
4. **管理员引导**：`ensureAdmin` 按"当前使用的 SQL 连接对象"记一次标志，多实例冷启动时可能
   并发尝试创建，已靠 `users.email` 唯一约束兜底，日志里出现重复尝试属正常现象。
5. **PBKDF2 迭代次数**：固定在 Cloudflare Workers 的硬上限 100,000 次以内（见
   `apps/api/src/lib/crypto.ts`），不要手动调高，否则在 Cloudflare 上会直接抛错导致登录/注册失败。

---

## 可选优化（后续建议）

- **前端 bundle 体积**：五个编辑器（Tiptap / Fortune Sheet / docx / exceljs / pptxgenjs）均已做
  路由级代码分割（`React.lazy` + 动态 `import()`），只有真正打开某种文档或触发导出时才会下载对应
  代码；如果后续继续增重，可考虑把 `@drawnix/drawnix`（思维导图核心依赖）也拆进独立 chunk。
- **Word 导出 docx**：当前 `exportWordToDocx` 覆盖段落/标题/粗斜体/下划线/删除线/高亮/
  列表/引用/表格/图片/内嵌思维导图占位，公式、分栏、页眉页脚等高级排版暂不支持。
- **Markdown/Word 内嵌思维导图**：目前是把一份独立的 Drawnix 元素树直接存进宿主文档的 `mindmaps`
  字段（而不是跨文档引用），这样分享/导出天然带着数据，但也意味着它不会同步其它"思维导图类型"文档
  的编辑；如果需要"引用同一份思维导图文档"的语义，需要额外的跨文档权限设计。
