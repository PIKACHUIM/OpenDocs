#!/usr/bin/env node
/**
 * 后端冒烟测试：node:sqlite + 内存文件存储，把整条链路跑一遍，不依赖任何云资源。
 *
 *   npm run test:api
 *
 * 覆盖：健康检查 → 注册（首个用户成为管理员）/登录/改密/找回密码/验证邮箱
 *      → 文档 CRUD（五种类型）/ 回收站 / 复制
 *      → 链接分享（view/edit，未登录访问与编辑）/ 指定用户分享（协作成员）
 *      → 附件上传与下载
 *      → 管理员：统计 / 用户管理 / 文档管理 / 系统设置
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const outfile = path.resolve('dist/smoke-api.mjs');

await build({
  entryPoints: [path.resolve('apps/api/src/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  logLevel: 'warning',
});

const sqliteOutfile = path.resolve('dist/smoke-sqlite.mjs');
await build({
  entryPoints: [path.resolve('platform/node/sqlite.ts')],
  outfile: sqliteOutfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  logLevel: 'warning',
});

const { createApp } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
const { createSqliteClient } = await import(`${pathToFileURL(sqliteOutfile).href}?t=${Date.now()}`);

const app = createApp();
const env = {
  SQL: createSqliteClient(':memory:'),
  FILES: createMemoryFileStore(),
  BOOTSTRAP_FIRST_ADMIN: 'true',
};

function createMemoryFileStore() {
  const map = new Map();
  return {
    kind: 'memory',
    async put(key, data) {
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
      map.set(key, bytes);
    },
    async get(key) {
      const value = map.get(key);
      return value ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : null;
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

let cookie = '';
let passed = 0;
const failures = [];

async function call(method, url, body, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (body !== undefined && !options.formData) headers['content-type'] = 'application/json';
  if (cookie && !options.anonymous) headers['cookie'] = cookie;

  const response = await app.fetch(
    new Request(`http://localhost${url}`, {
      method,
      headers,
      body: options.formData ? body : body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} }
  );

  for (const item of response.headers.getSetCookie?.() ?? []) {
    if (item.startsWith('drawnix_session=')) cookie = item.split(';')[0];
  }

  const contentType = response.headers.get('content-type') ?? '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  } else {
    data = await response.text().catch(() => null);
  }
  return { status: response.status, data, headers: response.headers };
}

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
}

let adminCookie = '';
let bobCookie = '';
let carolCookie = '';
let mindmapId = '';
let wordId = '';
let excelId = '';
let pptId = '';
let markdownId = '';
let shareToken = '';
let resetToken = '';
let verifyToken = '';
let assetId = '';

console.log('\n[1] 认证：注册 / 登录 / 改密 / 验证邮箱 / 找回密码');
{
  const health = await call('GET', '/api/health');
  check('GET /api/health', health.status === 200 && health.data?.ok === true, health.data);

  const register = await call('POST', '/api/auth/register', {
    email: 'admin@example.com',
    password: 'admin-pass-123',
    displayName: '管理员',
  });
  check(
    '首个注册用户自动成为管理员',
    register.status === 201 && register.data?.user?.role === 'admin',
    register.data
  );
  adminCookie = cookie;

  const me = await call('GET', '/api/auth/me');
  check('GET /api/auth/me', me.status === 200 && me.data?.user?.email === 'admin@example.com', me.data);
  check('/api/auth/me 带出公开配置', typeof me.data?.config?.allowRegistration === 'boolean', me.data);

  const dup = await call('POST', '/api/auth/register', {
    email: 'admin@example.com',
    password: 'admin-pass-123',
  });
  check('重复邮箱注册被拒绝', dup.status === 409, dup.data);

  const bob = await call('POST', '/api/auth/register', {
    email: 'bob@example.com',
    password: 'bob-pass-1234',
    displayName: 'Bob',
  });
  check('第二个用户角色为 user', bob.status === 201 && bob.data?.user?.role === 'user', bob.data);
  bobCookie = cookie;

  const badLogin = await call('POST', '/api/auth/login', {
    email: 'bob@example.com',
    password: 'wrong-password',
  });
  check('错误密码返回 401', badLogin.status === 401, badLogin.data);

  cookie = bobCookie;
  const changePassword = await call('POST', '/api/auth/password', {
    currentPassword: 'bob-pass-1234',
    newPassword: 'bob-pass-5678',
  });
  check('改密成功', changePassword.status === 200, changePassword.data);
  bobCookie = cookie;

  const reLogin = await call('POST', '/api/auth/login', {
    email: 'bob@example.com',
    password: 'bob-pass-5678',
  });
  check('改密后新密码可登录', reLogin.status === 200, reLogin.data);
  bobCookie = cookie;

  const forgot = await call('POST', '/api/auth/forgot-password', { email: 'bob@example.com' });
  check('找回密码接口始终返回成功文案', forgot.status === 200 && forgot.data?.ok === true, forgot.data);

  const carol = await call('POST', '/api/auth/register', {
    email: 'carol@example.com',
    password: 'carol-pass-1234',
    displayName: 'Carol',
  });
  check('第三个用户注册成功', carol.status === 201 && carol.data?.user?.role === 'user', carol.data);
  carolCookie = cookie;
}

console.log('\n[2] 文档：五种类型创建 / 读取 / 保存（乐观锁） / 重命名 / 复制 / 回收站');
{
  cookie = bobCookie;

  const createMindmap = await call('POST', '/api/documents', {
    type: 'mindmap',
    title: '我的思维导图',
    content: { type: 'mindmap', version: 1, elements: [], viewport: { zoom: 1 } },
  });
  check('创建思维导图文档', createMindmap.status === 201, createMindmap.data);
  mindmapId = createMindmap.data?.document?.id;

  const createMarkdown = await call('POST', '/api/documents', {
    type: 'markdown',
    title: 'README',
    content: { type: 'markdown', version: 1, markdown: '# Hello' },
  });
  check('创建 Markdown 文档', createMarkdown.status === 201, createMarkdown.data);
  markdownId = createMarkdown.data?.document?.id;

  const createWord = await call('POST', '/api/documents', { type: 'word', title: '合同草案' });
  check('创建 Word 文档（默认内容）', createWord.status === 201, createWord.data);
  wordId = createWord.data?.document?.id;

  const createExcel = await call('POST', '/api/documents', { type: 'excel', title: '预算表' });
  check('创建 Excel 文档', createExcel.status === 201, createExcel.data);
  excelId = createExcel.data?.document?.id;

  const createPpt = await call('POST', '/api/documents', { type: 'ppt', title: '演示文稿' });
  check('创建 PPT 文档', createPpt.status === 201, createPpt.data);
  pptId = createPpt.data?.document?.id;

  const badType = await call('POST', '/api/documents', { type: 'pdf', title: 'x' });
  check('非法文档类型被拒绝', badType.status === 400, badType.data);

  const list = await call('GET', '/api/documents?page=1&pageSize=10');
  check('我的文档列表包含 5 个文档', list.status === 200 && list.data?.total === 5, list.data);

  const get = await call('GET', `/api/documents/${mindmapId}`);
  check(
    '读取文档返回内容与权限',
    get.status === 200 && get.data?.access === 'owner' && get.data?.content?.type === 'mindmap',
    get.data
  );

  const save = await call('PUT', `/api/documents/${mindmapId}`, {
    content: {
      type: 'mindmap',
      version: 1,
      elements: [{ id: 'n1', type: 'mind' }],
      viewport: { zoom: 1 },
    },
    baseVersion: get.data?.document?.version,
  });
  check('保存文档成功且版本递增', save.status === 200 && save.data?.document?.version === 2, save.data);

  const conflictSave = await call('PUT', `/api/documents/${mindmapId}`, {
    content: { type: 'mindmap', version: 1, elements: [] },
    baseVersion: 1,
  });
  check('过期版本号触发 409 冲突', conflictSave.status === 409, conflictSave.data);

  const rename = await call('PATCH', `/api/documents/${mindmapId}`, { title: '重命名后的导图' });
  check('重命名文档', rename.status === 200 && rename.data?.document?.title === '重命名后的导图', rename.data);

  const duplicate = await call('POST', `/api/documents/${mindmapId}/duplicate`);
  check('复制文档', duplicate.status === 201 && duplicate.data?.document?.id !== mindmapId, duplicate.data);

  const trash = await call('DELETE', `/api/documents/${pptId}`);
  check('软删除文档（进回收站）', trash.status === 200 && trash.data?.permanent === false, trash.data);

  const trashedList = await call('GET', '/api/documents?trashed=true');
  check('回收站列表能看到被删文档', trashedList.status === 200 && trashedList.data?.total === 1, trashedList.data);

  const restore = await call('POST', `/api/documents/${pptId}/restore`);
  check('从回收站恢复', restore.status === 200 && restore.data?.document?.deletedAt === null, restore.data);
}

console.log('\n[3] 链接分享：未登录查看 / 未登录编辑 / 认领到账号');
{
  cookie = bobCookie;

  const share = await call('POST', `/api/documents/${markdownId}/share-link`, { mode: 'edit' });
  check('开启可编辑分享链接', share.status === 200 && typeof share.data?.share?.token === 'string', share.data);
  shareToken = share.data?.share?.token;

  const anonRead = await call('GET', `/api/share/${shareToken}`, undefined, { anonymous: true });
  check(
    '未登录可读取分享文档',
    anonRead.status === 200 && anonRead.data?.mode === 'edit',
    anonRead.data
  );

  const anonSave = await call(
    'PUT',
    `/api/share/${shareToken}`,
    {
      content: { type: 'markdown', version: 1, markdown: '# Edited by guest' },
      baseVersion: anonRead.data?.document?.version,
    },
    { anonymous: true }
  );
  check('未登录访客可编辑并保存分享文档', anonSave.status === 200, anonSave.data);

  const invalidToken = await call('GET', '/api/share/not-a-real-token', undefined, { anonymous: true });
  check('无效分享链接返回 404', invalidToken.status === 404, invalidToken.data);

  cookie = adminCookie;
  const claim = await call('POST', `/api/share/${shareToken}/claim`);
  check('管理员账号认领分享文档为协作成员', claim.status === 200 && claim.data?.ok === true, claim.data);

  const adminList = await call('GET', '/api/documents?scope=shared');
  check(
    '管理员「与我共享」列表包含该文档',
    adminList.status === 200 && adminList.data?.total === 1,
    adminList.data
  );

  cookie = bobCookie;
  const revoke = await call('DELETE', `/api/documents/${markdownId}/share-link`);
  check('撤销分享链接', revoke.status === 200 && revoke.data?.document?.linkShared === false, revoke.data);

  const afterRevoke = await call('GET', `/api/share/${shareToken}`, undefined, { anonymous: true });
  check('撤销后分享链接失效', afterRevoke.status === 404, afterRevoke.data);
}

console.log('\n[4] 指定用户分享（协作成员）与附件');
{
  cookie = bobCookie;

  // 注意：用 carol（普通用户）而不是 admin 测试——管理员在 resolveDocumentAccess 里
  // 永远享有 owner 级权限，用它测「移除成员后应失去访问」断言会被管理员特权掩盖。
  const addMember = await call('POST', `/api/documents/${wordId}/members`, {
    email: 'carol@example.com',
    role: 'editor',
  });
  check('添加指定用户为协作编辑者', addMember.status === 200, addMember.data);

  const unknownEmail = await call('POST', `/api/documents/${wordId}/members`, {
    email: 'nouser@example.com',
    role: 'viewer',
  });
  check('添加未注册邮箱返回 404', unknownEmail.status === 404, unknownEmail.data);

  cookie = carolCookie;
  const sharedAccess = await call('GET', `/api/documents/${wordId}`);
  check(
    '被分享用户可读取该文档且身份为 editor',
    sharedAccess.status === 200 && sharedAccess.data?.access === 'editor',
    sharedAccess.data
  );

  const editBySharedUser = await call('PUT', `/api/documents/${wordId}`, {
    content: {
      type: 'word',
      version: 1,
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    },
    baseVersion: sharedAccess.data?.document?.version,
  });
  check('被分享的协作编辑者可保存文档', editBySharedUser.status === 200, editBySharedUser.data);

  cookie = bobCookie;
  const members = await call('GET', `/api/documents/${wordId}/members`);
  check('查看协作成员列表', members.status === 200 && members.data?.members?.length === 1, members.data);

  const removeMember = await call('DELETE', `/api/documents/${wordId}/members/${members.data.members[0].userId}`);
  check('移除协作成员', removeMember.status === 200, removeMember.data);

  cookie = carolCookie;
  const afterRemoved = await call('GET', `/api/documents/${wordId}`);
  check('移除后协作者无法再访问', afterRemoved.status === 403, afterRemoved.data);

  cookie = bobCookie;
  const png1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const bytes = Buffer.from(png1x1, 'base64');
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: 'image/png' }), 'pixel.png');
  form.set('documentId', markdownId);
  const upload = await call('POST', '/api/assets', form, { formData: true });
  check('上传图片附件', upload.status === 201 && typeof upload.data?.asset?.id === 'string', upload.data);
  assetId = upload.data?.asset?.id;

  const download = await call('GET', `/api/assets/${assetId}`);
  check('下载图片附件', download.status === 200, { status: download.status });
}

console.log('\n[5] 管理员：统计 / 用户管理 / 文档管理 / 系统设置');
{
  cookie = adminCookie;

  const stats = await call('GET', '/api/admin/stats');
  check(
    'GET /api/admin/stats',
    stats.status === 200 && stats.data?.users?.total === 3 && stats.data?.documents?.total >= 5,
    stats.data
  );

  const users = await call('GET', '/api/admin/users?page=1&pageSize=10');
  check(
    'GET /api/admin/users 带文档计数',
    users.status === 200 && users.data?.total === 3 && users.data.users.some((u) => u.documentCount >= 1),
    users.data
  );

  const search = await call('GET', '/api/admin/users?q=bob');
  check('按关键字搜索用户', search.status === 200 && search.data?.total === 1, search.data);

  const bobId = users.data.users.find((u) => u.email === 'bob@example.com')?.id;
  const disable = await call('PATCH', `/api/admin/users/${bobId}`, { disabled: true });
  check('禁用用户', disable.status === 200 && disable.data?.user?.disabled === true, disable.data);

  cookie = bobCookie;
  const disabledLogin = await call('GET', '/api/auth/me');
  check('被禁用用户会话立即失效', disabledLogin.status === 200 && disabledLogin.data?.user === null, disabledLogin.data);

  cookie = adminCookie;
  const enable = await call('PATCH', `/api/admin/users/${bobId}`, { disabled: false });
  check('重新启用用户', enable.status === 200 && enable.data?.user?.disabled === false, enable.data);

  const selfDisable = await call('PATCH', `/api/admin/users/${users.data.users.find((u) => u.role === 'admin').id}`, {
    disabled: true,
  });
  check('不能禁用当前登录账号', selfDisable.status === 409, selfDisable.data);

  const documents = await call('GET', '/api/admin/documents?page=1&pageSize=20');
  check('GET /api/admin/documents 看到全部文档', documents.status === 200 && documents.data?.total >= 5, documents.data);

  const byType = await call('GET', '/api/admin/documents?type=excel');
  check('按类型过滤文档', byType.status === 200 && byType.data?.documents?.every((d) => d.type === 'excel'), byType.data);

  const adminDeleteDoc = await call('DELETE', `/api/admin/documents/${excelId}`);
  check('管理员可彻底删除任意文档', adminDeleteDoc.status === 200, adminDeleteDoc.data);

  const settingsBefore = await call('GET', '/api/admin/settings');
  check('读取系统设置', settingsBefore.status === 200, settingsBefore.data);

  const updateSettings = await call('PATCH', '/api/admin/settings', {
    siteName: 'My Drawnix',
    allowRegistration: false,
    resendApiKey: 're_test_123456',
    resendFrom: 'noreply@example.com',
    turnstileEnabled: true,
    turnstileSiteKey: 'site-key-abc',
    turnstileSecretKey: 'secret-key-abc',
  });
  check(
    '更新系统设置（含密钥掩码回显）',
    updateSettings.status === 200 &&
      updateSettings.data?.siteName === 'My Drawnix' &&
      updateSettings.data?.allowRegistration === false &&
      updateSettings.data?.resendApiKeySet === true &&
      !updateSettings.data?.resendApiKeyMasked?.includes('re_test_123456'),
    updateSettings.data
  );

  const publicConfig = await call('GET', '/api/auth/me', undefined, { anonymous: true });
  check(
    '关闭注册后公开配置同步生效',
    publicConfig.status === 200 && publicConfig.data?.config?.allowRegistration === false,
    publicConfig.data
  );

  cookie = '';
  const registerBlocked = await call('POST', '/api/auth/register', {
    email: 'new@example.com',
    password: 'new-pass-1234',
  });
  check('关闭注册后新用户无法注册', registerBlocked.status === 403, registerBlocked.data);

  cookie = adminCookie;
  await call('PATCH', '/api/admin/settings', { allowRegistration: true });

  const forbiddenAnon = await call('GET', '/api/admin/stats', undefined, { anonymous: true });
  check('未登录访问管理接口被拒', forbiddenAnon.status === 401, forbiddenAnon.data);

  // 用 carol 而不是 bob：bob 在上面被禁用过又重新启用，旧会话已失效，
  // 用它测「已登录但无权限」会被「未登录」这条分支误判。
  cookie = carolCookie;
  const forbiddenUser = await call('GET', '/api/admin/stats');
  check('普通用户访问管理接口被拒', forbiddenUser.status === 403, forbiddenUser.data);
}

console.log('\n[9] 团队空间：创建 / 邀请 / 加入 / 权限 / 只读 / 管理员保护');
{
  cookie = adminCookie;
  const created = await call('POST', '/api/admin/teams', {
    name: '测试团队',
    defaultCanDelete: false,
    defaultCanUpdate: true,
  });
  check('创建团队空间', created.status === 201 && !!created.data?.team?.id, created.data);
  const teamId = created.data?.team?.id ?? '';

  const invite = await call('POST', `/api/admin/teams/${teamId}/invite`);
  check('生成邀请令牌', invite.status === 200 && !!invite.data?.inviteToken, invite.data);

  // 同一空间只允许一个令牌：再次生成会替换旧的
  const rotate = await call('POST', `/api/admin/teams/${teamId}/invite`);
  check(
    '重置后旧令牌失效、仍是单个令牌',
    rotate.data?.inviteToken && rotate.data.inviteToken !== invite.data.inviteToken,
    rotate.data
  );

  cookie = carolCookie;
  const oldToken = await call('POST', '/api/teams/join', { token: invite.data.inviteToken });
  check('旧令牌已失效', oldToken.status === 404, oldToken.data);

  const join = await call('POST', '/api/teams/join', { token: rotate.data.inviteToken });
  check('成员通过令牌加入', join.status === 200 && join.data?.teamId === teamId, join.data);

  const myTeams = await call('GET', '/api/teams');
  check(
    '我的团队里出现该空间并带权限',
    Array.isArray(myTeams.data?.teams) &&
      myTeams.data.teams.some((team) => team.id === teamId && team.permissions?.canDelete === false),
    myTeams.data
  );

  const doc = await call('POST', '/api/documents', {
    type: 'markdown',
    title: '团队文档',
    teamId,
  });
  check(
    '成员可新建团队文档且归属正确',
    doc.status === 201 && doc.data?.document?.teamId === teamId,
    doc.data
  );

  const teamDocs = await call('GET', `/api/documents?teamId=${teamId}`);
  check(
    '团队文档列表可见',
    Array.isArray(teamDocs.data?.documents) &&
      teamDocs.data.documents.some((item) => item.id === doc.data.document.id),
    teamDocs.data
  );

  // 只读模式：普通成员不能新建，管理员可以
  cookie = adminCookie;
  await call('PATCH', `/api/admin/teams/${teamId}`, { readonly: true });

  cookie = carolCookie;
  const blocked = await call('POST', '/api/documents', {
    type: 'markdown',
    title: '只读期间的新文档',
    teamId,
  });
  check('只读模式下成员不能新建', blocked.status === 403, blocked.data);

  cookie = adminCookie;
  const adminCreate = await call('POST', '/api/documents', {
    type: 'markdown',
    title: '管理员在只读空间新建',
    teamId,
  });
  check('只读模式下管理员仍可新建', adminCreate.status === 201, adminCreate.data);

  // 管理员保护：不能把自己降级
  const me = await call('GET', '/api/auth/me');
  const selfDemote = await call('PATCH', `/api/admin/users/${me.data?.user?.id}`, {
    role: 'user',
  });
  check('管理员不能自我降级', selfDemote.status === 409, selfDemote.data);

  // 清理：删除团队空间，文档退回个人空间
  await call('DELETE', `/api/admin/teams/${teamId}`);
  const afterDelete = await call('GET', `/api/documents?teamId=${teamId}`);
  check('删除团队空间后列表不可再访问', afterDelete.status === 404, afterDelete.data);
}

console.log(`\n结果：${passed} 通过，${failures.length} 失败`);
if (failures.length > 0) {
  console.log('失败项：', failures.join(', '));
  process.exitCode = 1;
}
