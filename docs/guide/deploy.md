# 部署方式

## 前置条件

- Node 20+
- 一个 Cloudflare 账号（D1 + R2 免费额度足够小团队使用）
- 部署 EdgeOne 时额外需要：Cloudflare API Token（D1 编辑权限）

## 方案对比

| 方案 | 适用 | 前端 | 后端 | 数据 |
| --- | --- | --- | --- | --- |
| Cloudflare Workers | 推荐，全球访问 | Static Assets | 同一个 Worker | D1 + R2 |
| EdgeOne | 面向国内访问 | EdgeOne Pages | Cloud Functions(Node) | D1 HTTP API + Blob |
| 纯静态 | 只想用本地白板 | 任意静态托管 | 无 | 仅浏览器 |

---

## A. Cloudflare Workers（推荐）

### 1. 创建资源

```bash
npx wrangler d1 create opendocs
# 记下输出的 database_id

npx wrangler r2 bucket create opendocs-files
```

### 2. 准备配置

仓库只提交模板文件，真实资源 ID 不进版本库：

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

把 `d1_databases[].database_id` 填成上一步的 ID，`name` 改成自己的 Worker 名（全局唯一），
`r2_buckets[].bucket_name` 改成自己的桶名。

### 3. 初始化数据库

```bash
npx wrangler d1 execute opendocs --remote --file=./migrations/0001_init.sql
npx wrangler d1 execute opendocs --remote --file=./migrations/0002_folders_invites.sql
```

> 服务端首次请求也会幂等建表，但生产环境建议显式执行，便于确认。

### 4. 部署

```bash
npm run deploy:cf      # 等价于 nx build web && wrangler deploy
```

部署成功后形如 `https://<worker-name>.<subdomain>.workers.dev`。

### 5. 配置密钥（可选）

```bash
npx wrangler secret put ADMIN_EMAIL       # 管理员邮箱
npx wrangler secret put ADMIN_PASSWORD    # 管理员密码，≥8 位
npx wrangler secret put RESEND_API_KEY    # 找回密码/验证邮件
npx wrangler secret put TURNSTILE_SECRET_KEY
```

也可以不配环境变量，登录后在管理后台「系统设置」里填（数据库配置优先于环境变量）。

### 6. 绑定自定义域名

Workers 控制台 → 选择 Worker → **Settings → Domains & Routes → Add custom domain**，
填写例如 `docs.example.com`，按提示在 DNS 里加记录即可。

> `*.workers.dev` 在国内访问不稳定。面向国内用户时建议绑定自有域名，
> 并注意域名需要已完成备案。

---

## B. EdgeOne Cloud Functions

EdgeOne 没有 D1，但可以直接调用 Cloudflare D1 的 HTTP API，因此数据库仍然是同一个 D1 库。

### 1. 构建

```bash
npm run build:edge
```

该命令会：

1. `nx build web` 产出静态站点到 `dist/apps/web`
2. `scripts/build-edge.mjs` 用 esbuild 把 Hono 打包成单文件
   `cloud-functions/api/[[default]].js`，并复制到 `dist/apps/web/cloud-functions/`

### 2. 控制台配置

```
构建命令：npm run build:edge
输出目录：dist/apps/web
```

环境变量：

| 名称 | 说明 |
| --- | --- |
| `D1_ACCOUNT_ID` | Cloudflare 账户 ID |
| `D1_DATABASE_ID` | D1 数据库 ID |
| `D1_API_TOKEN` | 有 D1 编辑权限的 API Token |
| `EDGEONE_BLOB_STORE` | 可选，Blob 命名空间，默认自动创建 |

### 3. SPA 深链

EdgeOne 不读取 `_redirects`，需要在控制台开启「单页应用回退」，
或新增 `cloud-functions/[[default]].js` 兜底到 `index.html`。

---

## C. 文档站（VitePress）

文档站与应用是两个独立站点，可以部署在不同域名。

### 本地预览

```bash
npm run docs:dev      # http://localhost:5173
```

### 构建

```bash
npm run docs:build    # 产物在 docs/.vitepress/dist
```

### 部署到 Cloudflare Pages

1. Pages 控制台 → Create a project → Connect to Git
2. 构建配置：

   ```
   Build command: npm run docs:build
   Build output directory: docs/.vitepress/dist
   ```

3. 部署完成后进入 **Custom domains** → 添加 `docs.example.com`
4. 按提示在 DNS 添加 CNAME 记录，等待证书签发

### 部署到 GitHub Pages

```bash
npm run docs:build
# 把 docs/.vitepress/dist 推到 gh-pages 分支
```

`docs/public/CNAME` 里的域名会被一并发布，GitHub Pages 据此绑定自定义域。

### 修改文档域名

自定义域名涉及三处，改的时候保持一致：

1. `docs/.vitepress/config.ts` 里的 `SITE_URL`（影响 sitemap 与 canonical）
2. `docs/public/CNAME`
3. 部署平台的自定义域设置

> 如果站点部署在子路径（如 `https://example.com/docs/`），还需要把 config 里的 `base` 改成 `'/docs/'`。

---

## 环境变量一览

| 名称 | 作用 | 必需 |
| --- | --- | --- |
| `SITE_NAME` | 站点名称（默认 OpenDocs） | 否 |
| `SITE_URL` | 站点 URL，用于邮件里的链接 | 否 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 引导管理员账号 | 否 |
| `BOOTSTRAP_FIRST_ADMIN` | 首个注册者成为管理员，默认 true | 否 |
| `ALLOW_REGISTRATION` | 注册总开关，默认 true | 否 |
| `INVITE_REQUIRED` | 注册必须使用邀请码，默认 false | 否 |
| `RESEND_API_KEY` / `RESEND_FROM` | 邮件服务 | 否 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 人机验证 | 否 |
| `CORS_ORIGIN` | 跨域调试时允许的来源 | 否 |

## 常见问题

**部署报 `Invalid _redirects configuration: Infinite loop detected`**
说明 `public/_redirects` 里有 catch-all 代理规则。Workers 的 SPA 回退请用
`assets.not_found_handling: "single-page-application"`，不要同时写 `_redirects`。

**报 `binding DB of type d1 must have a valid database_id`**
`wrangler.jsonc` 里的 `database_id` 还是占位符，换成真实 ID。

**登录/注册一直失败**
检查两个迁移是否都执行过（`0002` 会补 `documents` 的新列与 `folders`/`invite_codes` 表）。

**静态资源也走了 Worker，额度掉得快**
确认 `assets.run_worker_first` 只包含 `/api/*`。
