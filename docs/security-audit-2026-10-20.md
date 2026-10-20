# OpenDocs 安全审计报告

- 审计对象：本仓库（`apps/api` Hono 后端 + `apps/web` React 前端 + 三平台适配层）
- 线上实例：`https://road.oplist.org/`（Cloudflare Workers + D1 + R2）
- 审计日期：2026-10-20
- 审计方式：源码全量审读 + 本地实机模拟攻击（`platform/node` + `node:sqlite`，独立端口与独立库）+ 线上非侵入式侦察

> 说明：线上仅执行了只读请求（`/`、`/api/health`、`/api/auth/me`、`/api/assets/:id`、`/api/share/:token`、404、CORS 预检、空注册体），**未对线上做爆破、上传、写操作或任何破坏性验证**；所有攻击链均在本地实例复现。

---

## 1. 结论摘要

| 级别 | 数量 | 概述 |
| --- | --- | --- |
| 高危 | 3 | SVG 同源存储型 XSS、团队邀请令牌越权下发、容量/团队上传策略完全未生效 |
| 中危 | 8 | 乐观锁被绕过导致内容互相覆盖、无服务端限流、登录时间侧信道枚举邮箱、邮箱未验证可被抢注、邮件链接使用请求 Origin、缺失 CSP 等安全头、ADMIN_EMAIL 静默提权、资源强缓存不随权限撤销 |
| 低危/加固 | 10 | PBKDF2 迭代偏低、会话 30 天不轮换、信息泄露、级联删除不全、GET 有副作用、令牌明文入库等 |

**整体判断**：鉴权与权限模型（文档/目录/团队/管理端）实现得相当扎实，SQL 全部参数化，未发现注入与经典 IDOR；主要风险集中在 **「文件上传后的渲染信任」** 与 **「配额/限流等资源治理」** 两类，以及一个**权限数据暴露**问题。修复 P0 三项即可消除当前最现实的攻击链。

### 攻击链（最值得优先处理）

```
注册用户（或持有 edit 分享链接的匿名访客）
  → 上传 <svg><script>…</script></svg>  （第 8 节 XSS-1，响应体原样保留 script）
  → 得到一个同源 URL /api/assets/a_xxx.svg（image/svg+xml + 无 nosniff + 无 CSP + 无 attachment）
  → 在共享的 Markdown 文档里放 <a href="该URL"> / 在 PPT 里放 iframe(src=该URL, sandbox=allow-scripts allow-same-origin)
  → 受害者点击/打开文档 → 脚本在文档站同源执行 → 读取受害者全部文档（会话 Cookie 为 HttpOnly，但可直接同源调用 /api/*）
```

---

## 2. 审计范围与方法

- 后端：`apps/api/src/**`（routes / middleware / lib / repos / services / db / files / store）
- 前端：`apps/web/src/**`（Markdown、PPT、素材库、会话同步）
- 平台：`platform/cloudflare/worker.ts`、`platform/edgeone/entry.ts`、`platform/node/*`
- 配置：`wrangler.jsonc`、`apps/web/public/_headers`、`migrations/`、`.gitignore` 与密钥扫描

模拟攻击手段：注册/登录/改密/找回密码、越权访问（横向 + 纵向）、上传与内容渲染、分享链接与团队邀请、并发保存、配额与限流、CORS 与安全响应头、Host 头与 `X-Forwarded-Proto` 信任。

---

## 3. 高危发现

### H-1　SVG 上传 → 同源存储型 XSS（可劫持任意登录用户的文档）

**证据（本地实测）**

```
POST /api/assets  (multipart, file=<svg><script>alert(document.domain)</script></svg>, type=image/svg+xml)
→ 201 {"asset":{"id":"a_tKp5…","url":"/api/assets/a_tKp5…"}}

GET /api/assets/a_tKp5…  (带登录 Cookie)
→ 200
   content-type: image/svg+xml
   cache-control: private, max-age=31536000, immutable
   x-content-type-options: (缺失)
   content-security-policy: (缺失)
   content-disposition: (缺失)
   body: <svg …><script>alert(document.domain)</script></svg>   ← script 原样返回

（文档开启链接分享后）
GET /api/assets/a_tKp5…  （无 Cookie）
→ 200   ← 匿名也能拿到该 SVG
```

**成因**

1. `apps/api/src/routes/assets.ts:11-19` 显式允许 `image/svg+xml`，且只校验客户端可伪造的 `file.type`，不校验文件魔数（`image/png` 其实可以塞 HTML）。
2. `apps/api/src/routes/assets.ts:161-166` 直接以数据库里的 `content_type` 回写响应，且**没有** `Content-Disposition: attachment`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: sandbox`。
3. 素材 URL 与站点**同源**（`/api/assets/<id>`），因此 SVG 内的脚本拿到的是本站 origin：
   - 会话 Cookie 是 `HttpOnly`，读不到明文，但脚本可**直接以受害者身份调用同源 `/api/*`**（列出/读取/改写/分享其全部文档），等价于完整账户接管。
4. `apps/web/src/editors/ppt/PptElements.tsx:509-520` 的 `IframeView` 使用 `sandbox="allow-scripts allow-same-origin allow-popups"` 且 `src` 完全来自文档内容（`SlideIframeElement.src` 无协议/域名白名单）。`allow-scripts` + `allow-same-origin` 对**同源**内容是已知的沙箱逃逸组合（帧内可移除自己的 sandbox 属性并访问父窗口）。这使攻击从「受害者点击链接」升级为「**受害者只要打开被共享的 PPT 就会执行**」。
5. 站点未设置 CSP（见 M-6），浏览器没有任何兜底。

**影响**：任何注册用户（或持有 edit 分享链接的匿名访客，`assets.ts:64-69` 允许 shareToken 上传）都能拿到一个"打人"的同源脚本地址；配合链接分享/协作，可对站内其他用户（包括管理员）批量发起会话劫持。

**修复（P0，建议全部做）**

1. **服务端把 SVG 当不可信文件处理**：要么直接拒绝 `image/svg+xml`，要么上传时用 `resvg/sharp` 之类转成 PNG 落盘（边缘运行时可用 wasm 方案），要么只允许「无脚本」的 SVG 白名单（`<path>/<rect>/<g>` 等），剔除 `<script>`、`on*`、`<foreignObject>`、`xlink:href` 外链。
2. **下发时强制降权**：
   ```ts
   return new Response(data, {
     headers: {
       'Content-Type': asset.content_type,
       'X-Content-Type-Options': 'nosniff',
       'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
       'Content-Disposition': `inline; filename="${asset.id}.${ext}"`,
       'Cache-Control': 'private, max-age=0, must-revalidate',
     },
   });
   ```
   对非图片/非白名单类型统一 `attachment`。
3. **素材域名隔离**：把用户上传内容放到独立子域（如 `assets.example.com`，无 Cookie、无同源 API），这是根治手段。
4. **PPT iframe 收紧**：去掉 `allow-same-origin`（改用 `sandbox="allow-scripts allow-popups"` 或干脆只允许 `allow-scripts`），并对 `src` 做协议 + 域名白名单（禁 `javascript:`/`data:`/`blob:`，`/api/*` 同源路径默认禁止）。

代码位置：`apps/api/src/routes/assets.ts:11-19,52-55,135-167`；`apps/web/src/editors/ppt/PptElements.tsx:509-520`。

---

### H-2　团队邀请令牌对全体成员可见（可越权拉人 / 提权为团队管理员）

**证据（本地实测）**

```
管理员创建团队 sec-team（defaultIsAdmin=true）并把 userB 加为普通成员
POST /api/admin/teams/:id/invite  → {"inviteToken":"ti_BFnehffHcgHzCuF0"}

userB: GET /api/teams
→ teams[0].inviteToken === "ti_BFnehffHcgHzCuF0"      ← 泄漏
```

**成因**：`apps/api/src/routes/teams.ts:16-29` 直接把 `toPublicTeam(row)` 返回给成员，而 `toPublicTeam`（`apps/api/src/repos/types.ts:165-184`）包含 `inviteToken`。

**影响**：任何团队成员（含只读/访客级成员）都能读到空间口令，然后：
1. 用**自己的小号** `POST /api/teams/join` 加入；若该空间 `defaultIsAdmin=true`（`teams.ts` repo `create` 支持，管理后台可勾选"新成员默认为管理员"），小号直接成为团队管理员 → 可改团队设置、删除团队内所有文档；
2. 把口令外发给任意人，团队边界彻底失效；
3. 该令牌**永不过期**（只有管理员手动重置），泄漏后长期有效。

**修复（P0）**

- `GET /api/teams` 只返回 `permissions` 与展示字段，**移除 `inviteToken`**；令牌仅在 `POST /api/admin/teams/:id/invite` 的响应里出现一次（或单独 `GET /api/admin/teams/:id/invite`，仅团队管理员可读）。最小改动：
  ```ts
  const { inviteToken: _drop, ...safe } = toPublicTeam(row as TeamRecord);
  return { ...safe, permissions: {...} };
  ```
- 建议同时给邀请令牌加有效期与使用次数（当前是永久单令牌）。

---

### H-3　容量配额与团队上传策略完全未生效（存储成本 DoS）

**证据（本地实测）**

```
管理员 PATCH /api/admin/settings {"quotaUserBytes":1024}   → 200, GET 回显 1024
上传 64 KB PNG                                          → 201, 65536 bytes   ← 超过用户配额仍成功

团队 quotaBytes=1024, maxImageBytes=1024, allowImage=false
管理员向该团队上传 50 KB PNG                              → 201                ← 团队策略全部被忽略

对照组：PATCH {"uploadAllowImage":false} 后上传            → 403（全局开关有效）
```

**成因**

- `apps/api/src/routes/assets.ts:45-55` 只用了 `policy.maxImageBytes` 与 `policy.allowImage`；`policy.userQuotaBytes` / `policy.systemQuotaBytes` **从未参与校验**。
- `apps/api/src/repos/assets.ts` 里已有 `sumSizeByOwner` / `sumAllSize`，但**没有任何调用点**。
- 团队维度（`teams.quota_bytes` / `allow_image` / `max_image_bytes`）在素材上传链路里**完全没有读取**；只有 `POST /api/documents` 校验了团队 `quota_bytes`（`routes/documents.ts:241-250`）。
- `assets.ts:64-69` 允许**匿名**（持有 edit 分享令牌）上传，同样不受任何配额/频率约束。

**影响**：任意注册用户（或任何拿到公开 edit 分享链接的人）可无限上传 8 MB 文件，直接推高 R2 存储与出网费用；团队空间的容量/图片开关形同虚设。

**修复（P0/P1）**

```ts
// assets.ts 上传前
const scope = boundDocumentTeamId ? team : null;
const used = scope
  ? (await c.get('repos').teams.stats(scope.id)).usedBytes
  : await c.get('repos').assets.sumSizeByOwner(user.id);
const quota = scope?.quota_bytes ?? policy.userQuotaBytes;
if (quota > 0 && used + file.size > quota) throw badRequest('容量不足');
const total = await c.get('repos').assets.sumAllSize();
if (policy.systemQuotaBytes > 0 && total + file.size > policy.systemQuotaBytes) throw tooManyRequests('全站容量已满');
```
并补充团队级 `allowImage` / `maxImageBytes` 校验，以及按用户/IP 的上传频率限制。

---

## 4. 中危发现

### M-1　乐观锁被绕过：返回 409 但内容已被覆盖（并发编辑丢数据）

**证据（本地实测）**

```
POST /api/documents                       → v1
PUT {baseVersion:1, markdown:"v2-by-A"}   → 200（v2）
PUT {baseVersion:1, markdown:"stale-overwrite"} → 409 VERSION_CONFLICT
GET /api/documents/:id                    → markdown === "stale-overwrite"   ← 冲突内容已写进存储
```

**成因**：`apps/api/src/routes/documents.ts:302-321`（以及匿名的 `apps/api/src/routes/share.ts:45-62`）都是**先 `files.put()` 落盘、再 `documents.saveContent()` 判版本**。版本校验失败时只改了数据库更新时间，文件内容已经被覆盖，且 `saveContent` 的 `UPDATE … WHERE version = ?` 的 `changes` 从未检查（`repos/documents.ts:116-122`）。

**影响**：任何两个并发编辑者（或一个卡住的旧标签页）都会静默覆盖对方内容；攻击者也可用旧版本号故意覆盖（但需写权限，所以是数据完整性而非越权）。

**修复**：把 `files.put` 移到版本判定之后，用"D1 条件更新（CAS）先占位 → 拿到新版本 key → 再写内容"的顺序；内容 key 带版本号（`documents/<id>/<version>.json`），写失败可回滚。至少应：
```ts
const result = await repos.documents.reserveVersion(id, baseVersion); // UPDATE ... WHERE version=?，检查 changes
if (result.conflict) return 409;             // 不写内容
await files.put(result.contentKey, serialized);
```

### M-2　服务端零限流（线上仅靠 Turnstile 兜底）

**证据（本地实测）**

```
登录 40 次错误密码 → 40 × 401，无 429
找回密码 15 次      → 15 × 200，无 429（会反复发信并轮换令牌）
分享令牌 100 次     → 100 × 404，无 429
团队 join 30 次     → 30 × 404，无 429
```

线上 `register`/`login`/`forgot-password` 都要求 Turnstile（实测空注册体返回 `429 请完成人机验证`），所以**当前线上**爆破成本被抬高；但：
- Turnstile 开关在管理后台可一键关闭，且存在 `TURNSTILE_DISABLED` 环境变量强制关闭；
- 登录接口一次请求就要跑 PBKDF2 100k 迭代，无限次调用本身是廉价的 CPU 放大型 DoS；
- 分享/团队接口完全不经过 Turnstile，可被自由枚举（令牌熵足够，但形成放大面）。

**修复**：加边缘限流（Workers 可用 Durable Object / KV 计数，或 `RateLimit` binding）：按 IP+账号维度，登录 5 次/分、注册 3 次/时、找回密码 3 次/时、分享查询 60 次/分；连续失败 N 次后要求验证码或短时锁定。

### M-3　登录响应时间可枚举已注册邮箱

**证据（本地实测，文案相同但耗时差异巨大）**

```
已存在账号平均 52.8 ms，不存在账号平均 3.9 ms（差 ~49 ms ×8 次取均值）
```

**成因**：`apps/api/src/routes/auth.ts:180-191` 在账号不存在时**直接抛错返回**，存在时先跑 PBKDF2 再比对。文案做了统一，但时序没统一。

**修复**：账号不存在时也对一个固定的假盐跑一次同样迭代数的 `derive`，再返回同样的错误；或统一在失败路径做 `await sleep(固定值)` 拉到同一量级。

### M-4　邮箱未验证即可使用，且可被"抢注"后接收他人共享

**成因**：`auth.ts:126-167` 注册后**立即建立会话**；`email_verified` 不参与任何授权判断（全仓库无消费点）。而协作者分享、目录分享、团队加人**都以邮箱为身份标识**（`documents.ts:496-507`、`folders.ts:141-157`、`admin.ts:446-452`）。

**攻击**：攻击者先注册 `zhangsan@company.com`（不验证也能用），随后任何同事按邮箱把文档/目录共享给"张三"，攻击者直接读取；反之，真实员工永远无法用该邮箱注册（`conflict 该邮箱已注册`），形成账号占用。

**修复**：未验证邮箱禁止被邀请/被分享（或分享时提示"该邮箱未验证"）；注册后不建立完整会话（或会话只能访问"请验证邮箱"页面）；对长期未验证账号做回收。

### M-5　找回密码/验证邮件链接依赖请求 Origin（Host 头注入 → 令牌被引到攻击者域名）

**成因**：`auth.ts:79` 与 `auth.ts:266` 使用 `siteUrl || new URL(c.req.url).origin`；`siteUrl` 来自设置/`SITE_URL` 环境变量，**未配置时完全由请求 Host 决定**。本地实测 `Host: evil.example` 的 `POST /api/auth/forgot-password` 正常返回 200，说明 Host 被原样接受（`platform/node/dev.ts:50` 用 `req.headers.host` 拼 URL；EdgeOne/自建反代同理）。

**影响**：未配置 `SITE_URL` 的部署中，攻击者可让受害者收到 `https://evil.example/reset-password?token=…`，受害者点击后令牌进入攻击者站点 → 账号接管；邮件里的 `<a href>` 由 `services/mail.ts:63-92` 拼接，未做域名校验。

**修复**：`SITE_URL` 设为**必填**（缺失时启动即报错，生产不允许回退到请求 Origin）；如必须回退，只允许与白名单（`env.SITE_URL`/`CORS_ORIGIN`/部署域名）匹配的 Host，其余一律使用固定默认值；同时不要把 `X-Forwarded-Proto` 当作可信输入（本地实测可让它给 HTTP 响应打上 `Secure`，见附录 A-6）。

### M-6　安全响应头缺失（XSS 放大 + 点击劫持）

**证据（线上实测）**

```
GET /     → x-content-type-options: nosniff ✓, referrer-policy ✓
            content-security-policy: (无)  strict-transport-security: (无)  x-frame-options: (无)
GET /api/health → 无 nosniff / 无 CSP
GET /api/assets/:id → 无 nosniff / 无 CSP / 无 Content-Disposition
```

`apps/web/public/_headers` 只给静态资源设了 `nosniff` 与 `Referrer-Policy`，**没有 CSP/HSTS/frame 保护**，且注释已正确指出 `/api/*` 不经过 `_headers`——但代码里也没补。

**修复**：
1. `_headers` 增加
   ```
   /*
     Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self' https://www.youtube.com https://player.bilibili.com; frame-ancestors 'none'; base-uri 'none'; object-src 'none'
     Strict-Transport-Security: max-age=31536000; includeSubDomains
     X-Frame-Options: DENY
     Permissions-Policy: camera=(), microphone=(), geolocation=()
   ```
2. API 的 `json()` 与 assets 响应补 `X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; sandbox`。

### M-7　`ADMIN_EMAIL` 引导逻辑会把已存在的普通用户静默提升为管理员，并解除禁用

**成因**：`apps/api/src/services/bootstrap.ts:21-26`——只要 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 同时存在，且该邮箱已注册，就会执行 `role='admin', disabled=false`，**不校验密码**。

**影响**：`ADMIN_EMAIL` 若误配成某个普通用户的邮箱（或该邮箱先被攻击者注册），每次请求都会把对方提权并解封，且日志只有一行 `已将 … 提升为管理员`。属于典型的配置即后门。

**修复**：仅在该邮箱**尚不存在**时创建引导管理员；已存在时不再修改 role/disabled（或要求显式 `FORCE_ADMIN_BOOTSTRAP=true` 且仅执行一次并写审计）；同时不要在同一流程里解除 `disabled`。

### M-8　资源强缓存 1 年，权限撤销/删除后浏览器仍可读

`assets.ts:164` 返回 `Cache-Control: private, max-age=31536000, immutable`。素材 URL 在"文档开启链接分享"时对匿名开放；撤销分享、删除文档、移出团队后，**曾访问过的浏览器仍会从本地缓存直接命中**（`immutable` 连重新验证都跳过）。属信息残留风险，配合共享设备更明显。

**修复**：改为 `private, max-age=300, must-revalidate`，或给 URL 加带签名的短期参数（`?v=<hmac>&exp=`），让撤销立即生效。

---

## 5. 低危 / 加固建议

| ID | 问题 | 位置 | 建议 |
| --- | --- | --- | --- |
| L-1 | PBKDF2-SHA256 仅 100k 迭代（OWASP 建议 ≥600k），且无登录锁定 | `lib/crypto.ts:53` | 逐步提升到平台允许上限并做「登录成功即重哈希」迁移 |
| L-2 | 会话固定 30 天、无轮换、无设备列表；Cookie 未用 `__Host-` 前缀；`Authorization: Bearer` 直接复用会话 token | `repos/sessions.ts:6`、`middleware/index.ts:12-21` | TTL 降到 7 天 + 活跃续期；改名 `__Host-drawnix_session`；如需 API token 应单独签发可撤销的 key |
| L-3 | 信息泄露：`/api/health` 暴露 `d1+r2`；404 回显完整路径；`robots.txt` 内容损坏（输出了 YAML 头，线上同样如此） | `index.ts:53-59,29`、`public/robots.txt` | health 只返回 `{ok:true}`（或加鉴权）；404 不回显用户输入；修好 robots.txt |
| L-4 | 管理员删用户只清理前 500 篇文档，且不清理 assets | `routes/admin.ts:134-148` | 分页循环清理或改为按 owner 批量删除 + 素材级联 |
| L-5 | `GET /api/documents?trashed=true` 在 GET 上执行过期硬删 | `routes/documents.ts:171-182` | 改为定时任务/`POST /api/documents/trash/purge` |
| L-6 | 分享令牌与团队令牌**明文入库**（`link_token`、`invite_token`），DB 泄露即全部链接可用 | `repos/documents.ts:186-197`、`repos/teams.ts:149` | 只存 hash（`link_token_hash` 已有，`link_token` 可改为加密存储或仅在创建时返回一次） |
| L-7 | LIKE 通配符未转义（`users.list`、`listByTeam` 用原始 `%q%`） | `repos/users.ts:138-149`、`repos/documents.ts:79-82` | 统一用 `likePattern()`（`db/sql.ts:154`） |
| L-8 | 文档 `PATCH`/`PUT` 允许 editor 改标题（`canUpdate` 即改元数据） | `routes/documents.ts:329-339` | 标题变更限定 owner，或明确产品语义 |
| L-9 | KaTeX 输出直接 `dangerouslySetInnerHTML` | `apps/web/src/editors/ppt/PptElements.tsx:404-430` | 默认 `trust:false` 下当前安全，仍建议对输出再过一次 DOMPurify；`throwOnError` 降级分支返回原文更应转义 |
| L-10 | 团队文档的图片对团队成员返回 403（功能回归，非安全） | `routes/assets.ts:139-150` 只按 document_members + link_mode 判定，未接团队/目录权限 | 与 `loadAccessible` 用同一套 `resolvePermissions` |

### 额外的健壮性问题

- `POST /api/auth/verify-email/resend`、`forgot-password` 的邮件发送是同步 `await`（`services/mail.ts`），Resend 慢时会拖长响应并占满 Worker 时间；建议 `waitUntil` 异步化（注意失败重试与日志）。
- 注册响应里的 `emailSent` 在未配置 Resend 时也为 `true`（`sendEmail` 静默打日志），会误导前端/用户。
- `readJson` 无体积上限（`lib/http.ts:52`），`PUT /api/documents/:id` 依赖 8 MB 业务上限，但请求体在解析阶段已全量进内存；建议先按 `content-length` 拒绝。
- `normalizeDocumentContent` 以 `{...candidate}` 原样透传任意字段（含 `__proto__` 自有属性），服务端不做 `Object.assign` 所以暂无原型污染，但建议改为白名单字段拷贝。
- `reset-password` 的令牌消费是「先 SELECT 再 UPDATE `used_at`」（`repos/sessions.ts:87-102`），并发下同一令牌可能被消费两次；建议 `UPDATE … WHERE used_at IS NULL` 后检查 `changes`。

---

## 6. 已验证为「安全 / 设计正确」的部分

这些是审计中重点验证且**结论为通过**的项，修复时不要破坏：

1. **会话存储**：只存 `sha256(token)`，令牌 32 字节 CSPRNG；改密/重置/禁用账号都会 `removeByUser` 全端下线（`repos/sessions.ts`）。
2. **一次性令牌**：`verify_email` / `reset_password` 有 purpose 隔离、独立 TTL、消费后 `used_at` 标记，且同类型旧令牌作废。
3. **SQL 注入**：全仓库未发现字符串拼接用户输入进 SQL；`paging()` 做了数值 clamp。
4. **横向 / 纵向越权**（本地实测）：普通用户访问 `/api/admin/*` → 403；读/写/建分享他人文档 → 403；匿名读文档 → 401；他人目录成员列表 → 403；往他人目录建文档 → 400。
5. **权限模型**：`lib/access.ts` 的 文件 > 空间 > 目录 > 链接 优先级实现一致；删除只属于所有者；协作者不能改收藏/归档。
6. **令牌强度**：分享 160 bit、团队邀请 96 bit、资源 id 128 bit、邀请码默认 50 bit——均不可枚举；邀请码名额用 SQL 条件更新原子扣减（`repos/invites.ts:119-126`）。
7. **CORS**：未配置 `CORS_ORIGIN` 时不下发 `Access-Control-Allow-Origin`（实测 `Origin: https://evil.example` 无 ACAO）。注意仍会下发 `Access-Control-Allow-Credentials: true` 这一"空配置"，建议仅在 origin 命中白名单时才加。
8. **密钥回显**：管理端 `adminConfig()` 对 Resend/Turnstile 密钥只回显掩码（实测 `re_••••lmn`）。
9. **无 SSRF**：服务端出站请求目标固定（`api.resend.com`、`challenges.cloudflare.com`），无用户可控 URL 抓取。
10. **密钥卫生**：仓库内未发现硬编码的 API Key / 私钥 / `.env`；`wrangler.jsonc` 未入库（模板占位 `REPLACE_WITH_YOUR_D1_DATABASE_ID`）。
11. **上传白名单**：非白名单 MIME 直接 400；单文件大小上限生效；全局图片开关生效（实测 403）。
12. **生产 Turnstile 已开启**：`/api/auth/me` 返回 `turnstileEnabled: true`，注册/登录/找回密码都会强制校验。

---

## 7. 线上实例侦察结果（road.oplist.org）

| 项 | 观测 | 评价 |
| --- | --- | --- |
| 边缘 | `server: cloudflare`，存储 `d1+r2` | 正常 |
| 注册 | `inviteRequired: true` + Turnstile 开启 | 良好（关闭注册/邀请码双保险） |
| 认证入口 | 空注册体返回 `429 请完成人机验证` | Turnstile 生效 |
| 安全头 | 仅 `nosniff` + `referrer-policy`；无 CSP / HSTS / X-Frame-Options | M-6 |
| CORS | 预检 204，`Access-Control-Allow-Credentials: true` 但无 `Allow-Origin` | 不可利用，建议收敛 |
| 错误回显 | `{"error":"接口不存在: /api/unknown-endpoint"}` | 低（L-3） |
| robots.txt | 返回 YAML 头（`id: robots-txt`…）而非标准 robots 内容 | 低（L-3) |
| 资源接口 | `/api/assets/a_notexist` → `404 文件不存在` | 无差异回显，正常 |

**受限说明**：线上未做上传/爆破/写操作验证；H-1 是否可被已注册用户直接利用，取决于该实例是否允许注册用户上传 SVG（代码层面无额外限制，默认允许）。

---

## 8. 修复优先级清单

### P0（建议一周内）

1. `assets.ts`：拒绝或净化 SVG；响应加 `nosniff` + `CSP sandbox` + `Content-Disposition`；素材独立域名。
2. `PptElements.tsx`：`IframeView` 去掉 `allow-same-origin`，`src` 加协议/域名白名单。
3. `GET /api/teams`：不再下发 `inviteToken`。
4. 上传链路补齐 user/system/team 三级配额与团队 `allowImage`/`maxImageBytes`。

### P1（两周内）

5. `saveContent` 改为"先 CAS 占位、后写内容"，检查 `changes`。
6. 加服务端限流（登录/注册/找回密码/分享查询/上传），Turnstile 仅作补充。
7. 登录失败路径做等时处理（消除 M-3 时间侧信道）。
8. 未验证邮箱不得被邀请/分享；注册后引导验证。
9. `SITE_URL` 必填 + 不信任请求 Host / `X-Forwarded-Proto`。
10. 补 CSP / HSTS / X-Frame-Options / Permissions-Policy。

### P2（一个月内）

11. `bootstrap.ts` 只创建不存在的引导管理员，不再静默提权/解封。
12. 资源缓存改短 TTL 或签名 URL。
13. PBKDF2 迭代提升 + 登录成功重哈希；会话 TTL 缩短 + 轮换 + `__Host-` 前缀。
14. 管理员删号级联清理（分页循环 + assets）；GET 副作用改 POST。
15. 令牌减少明文入库；LIKE 统一转义；401/404 不回显用户输入。

---

## 附录 A：模拟攻击用例与实测结果（本地独立实例）

| 编号 | 用例 | 结果 | 判定 |
| --- | --- | --- | --- |
| A-1 | 匿名访问 `/api/documents` | 401 | 通过 |
| A-2 | 40 次错误密码登录 | 40×401，无 429，1919 ms | 失败（M-2） |
| A-3 | 登录耗时差异 | 52.8 ms vs 3.9 ms | 失败（M-3） |
| A-4 | 15 次找回密码 | 15×200，无 429 | 失败（M-2） |
| A-5 | 邀请码强制 | 错误码 400、正确码 201（开启后） | 通过 |
| A-6 | `X-Forwarded-Proto: https` 下的 Set-Cookie | 被写入 `Secure` | 头信任问题（M-5 关联） |
| A-7 | 普通用户访问 `/api/admin/{users,settings}` | 403 | 通过 |
| A-8 | 他人文档读/写/建分享 | 403 / 403 / 403 | 通过 |
| A-9 | 他人目录建文档 / 读目录成员 | 400 / 403 | 通过 |
| A-10 | 100 次错误分享 token | 100×404，无 429 | 失败（M-2，低） |
| A-11 | SVG 上传并读取 | 201；`image/svg+xml`；script 原样；无 nosniff/CSP/attachment；匿名可读 200 | 失败（H-1） |
| A-12 | 伪造版本号重复保存 | 409 但正文已被覆盖 | 失败（M-1） |
| A-13 | 1 KB 配额下上传 64 KB | 201 | 失败（H-3） |
| A-14 | 团队 `allowImage=false` 上传 | 201 | 失败（H-3） |
| A-15 | 团队成员读取本团队文档/其图片 | 200 / 403 | 文档通过；素材为功能缺陷（L-10） |
| A-16 | 团队成员读 `/api/teams` 中的 `inviteToken` | 可见 | 失败（H-2） |
| A-17 | `Origin: evil.example` 请求 `/api/auth/me` | 无 ACAO | 通过 |
| A-18 | 管理端读取 Resend/Turnstile 密钥 | 仅掩码 | 通过 |
| A-19 | 登出后重放旧 Cookie | 已失效 | 通过 |
| A-20 | 30 次错误团队令牌 join | 30×404，无 429 | 失败（M-2，低） |

**复现方式**（本地，不触碰线上）：

```bash
node node_modules/esbuild/bin/esbuild platform/node/dev.ts \
  --bundle --platform=node --format=esm --target=node20 \
  --packages=external --outfile=dist/audit-api.mjs

PORT=8799 SQLITE_FILE=.data/audit.sqlite node dist/audit-api.mjs
# 另开终端：用 fetch/curl 依次执行 A-1…A-20；
# 首个注册账号自动成为管理员（BOOTSTRAP_FIRST_ADMIN 默认 true）
```

> 审计结束后已停止本地实例，并删除审计库（`.data/audit.sqlite`）与本次上传的全部测试文件（11 个），未留残余数据。

---

## 附录 B：一句话总结

> 权限与数据模型是"做对了"的部分；**上传内容的渲染信任**（SVG/iframe）和**资源治理**（配额/限流）是"漏了"的部分。先修 H-1/H-2/H-3，再补限流、CSP 与邮箱验证，风险面即可收敛到可接受水平。
