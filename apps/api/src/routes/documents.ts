import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ApiEnv } from '../context';
import { permissionsToAccess, resolvePermissions } from '../lib/access';
import {
  assertContentSize,
  emptyContentFor,
  normalizeDocumentContent,
  summarizeContent,
} from '../lib/document-content';
import { getText } from '../files';
import {
  badRequest,
  forbidden,
  json,
  notFound,
  optionalString,
  readJson,
  requireEmail,
  requireString,
} from '../lib/http';
import { requireAuth } from '../middleware';
import { paging } from '../db/sql';
import {
  toPublicDocument,
  type DocumentMemberRole,
  type DocumentRecord,
  type DocumentType,
  type PermissionSet,
} from '../repos/types';

export const documentRoutes = new Hono<ApiEnv>();
documentRoutes.use('*', requireAuth);

const DOCUMENT_TYPES: DocumentType[] = ['mindmap', 'markdown', 'word', 'excel', 'ppt', 'image'];

function assertType(type: unknown): DocumentType {
  if (typeof type !== 'string' || !DOCUMENT_TYPES.includes(type as DocumentType)) {
    throw badRequest(`type 必须是 ${DOCUMENT_TYPES.join('/')} 之一`);
  }
  return type as DocumentType;
}

/**
 * 取文档并算出有效权限。
 * 优先级：文件 > 空间 > 文件夹（> 链接分享），与产品规则一致。
 */
async function loadAccessible(c: Context<ApiEnv>, id: string) {
  const document = await c.get('repos').documents.getActive(id);
  if (!document) throw notFound('文档不存在或已被删除');
  const user = c.get('user')!;
  const repos = c.get('repos');

  const documentPermissions = await repos.members.getPermissions(id, user.id);

  let teamPermissions: (PermissionSet & { isAdmin?: boolean }) | null = null;
  let teamReadonly = false;
  if (document.team_id) {
    const [member, team] = await Promise.all([
      repos.teams.getMember(document.team_id, user.id),
      repos.teams.getById(document.team_id),
    ]);
    teamReadonly = !!team?.readonly;
    if (member) {
      teamPermissions = {
        canCreate: !!member.can_create,
        canRead: true,
        canUpdate: !!member.can_update,
        canDelete: !!member.can_delete,
        isAdmin: !!member.is_admin,
      };
    }
  }

  let folderPermissions: PermissionSet | null = null;
  if (document.folder_id) {
    const row = await repos.folderMembers.get(document.folder_id, user.id);
    if (row) {
      folderPermissions = {
        canCreate: !!row.can_create,
        canRead: !!row.can_read,
        canUpdate: !!row.can_update,
        canDelete: !!row.can_delete,
      };
    }
  }

  const permissions = resolvePermissions({
    document,
    user,
    documentPermissions,
    teamPermissions,
    teamReadonly,
    folderPermissions,
  });

  return { document, permissions, access: permissionsToAccess(permissions) };
}

documentRoutes.get('/', async (c) => {
  const user = c.get('user')!;
  const scopeParam = c.req.query('scope');
  const scope = scopeParam === 'shared' ? 'shared' : scopeParam === 'sent' ? 'sent' : 'owned';
  const { page, pageSize } = paging(c.req.query('page'), c.req.query('pageSize'));
  const query = optionalString(c.req.query('q'), 200);
  const type = c.req.query('type');
  const trashed = c.req.query('trashed') === 'true';
  const starred = c.req.query('starred') === 'true';
  const recent = c.req.query('recent') === 'true';
  // folderId 三态：不传 = 不限目录；空字符串 / "root" = 根目录（未归档）；具体 id = 该目录
  const folderParam = c.req.query('folderId');
  const folderId =
    folderParam === undefined
      ? undefined
      : folderParam === '' || folderParam === 'root'
        ? null
        : folderParam;

  // 团队空间：返回该空间的文档（团队成员可见）
  const teamId = c.req.query('teamId');
  if (teamId) {
    const team = await c.get('repos').teams.getById(teamId);
    if (!team) throw notFound('团队空间不存在');
    const member = await c.get('repos').teams.getMember(team.id, user.id);
    if (!member && user.role !== 'admin') throw forbidden('不是该团队空间的成员');
    const result = await c.get('repos').documents.listByTeam(team.id, {
      page,
      pageSize,
      query,
      trashed,
    });
    const myRole = member?.is_admin
      ? 'owner'
      : member?.can_update
        ? 'editor'
        : 'viewer';
    return json({
      documents: result.items.map((item) =>
        toPublicDocument(item, {
          myRole: user.role === 'admin' ? 'owner' : (myRole as DocumentMemberRole | 'owner'),
        })
      ),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  }

  if (scope === 'shared') {
    const result = await c.get('repos').documents.listSharedWithMe(user.id, { page, pageSize, query });
    return json({
      documents: result.items.map((item) =>
        toPublicDocument(item, { myRole: item.member_role as DocumentMemberRole })
      ),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  }

  if (scope === 'sent') {
    const result = await c.get('repos').documents.listSharedByMe(user.id, { page, pageSize, query });
    return json({
      documents: result.items.map((item) => toPublicDocument(item, { myRole: 'owner' })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  }

  // 打开「最近删除」时惰性清理过期条目，避免为清理单独跑定时任务
  let retentionDays: number | undefined;
  if (trashed) {
    retentionDays = await c.get('settings').trashRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const expired = await c.get('repos').documents.listTrashedBefore(user.id, cutoff);
    for (const doc of expired) {
      await c.get('runtime').files.delete(doc.content_key);
      await c.get('repos').members.removeAllForDocument(doc.id);
      await c.get('repos').documents.hardDelete(doc.id);
    }
  }

  const result = await c.get('repos').documents.listOwned(user.id, {
    page,
    pageSize,
    query,
    type: type ? assertType(type) : undefined,
    trashed,
    starred,
    recent,
    folderId,
  });
  return json({
    documents: result.items.map((item) => toPublicDocument(item, { myRole: 'owner' })),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    retentionDays,
  });
});

documentRoutes.post('/', async (c) => {
  const user = c.get('user')!;
  const body = await readJson<{
    type?: unknown;
    title?: unknown;
    content?: unknown;
    folderId?: unknown;
    teamId?: unknown;
  }>(c.req.raw);
  const type = assertType(body.type);
  const title = optionalString(body.title, 120) ?? '未命名文档';

  // 目录：自己的目录直接可用；别人分享的目录需要「新建」权限
  let folderId: string | null = null;
  if (typeof body.folderId === 'string' && body.folderId.trim()) {
    const folder = await c.get('repos').folders.getActive(body.folderId.trim());
    if (!folder) throw badRequest('目标目录不存在');
    if (folder.owner_id !== user.id) {
      const grant = await c.get('repos').folderMembers.get(folder.id, user.id);
      if (!grant?.can_create) throw forbidden('没有在该目录新建文档的权限');
    }
    folderId = folder.id;
  }

  // 团队空间：必须是成员、有新建权限，且空间未处于只读模式
  let teamId: string | null = null;
  if (typeof body.teamId === 'string' && body.teamId.trim()) {
    const team = await c.get('repos').teams.getById(body.teamId.trim());
    if (!team) throw badRequest('团队空间不存在');
    const member = await c.get('repos').teams.getMember(team.id, user.id);
    if (!member && user.role !== 'admin') throw forbidden('不是该团队空间的成员');
    if (user.role !== 'admin') {
      if (team.readonly && !member?.is_admin) throw forbidden('该团队空间已开启只读模式');
      if (!member?.is_admin && !member?.can_create) throw forbidden('没有在该空间新建文档的权限');
    }
    teamId = team.id;
  }

  const content = normalizeDocumentContent(type, body.content ?? emptyContentFor(type));
  const serialized = JSON.stringify(content);
  assertContentSize(serialized);

  // 团队空间容量上限（0 表示不限）
  if (teamId) {
    const team = await c.get('repos').teams.getById(teamId);
    if (team && team.quota_bytes > 0) {
      const stats = await c.get('repos').teams.stats(team.id);
      if (stats.usedBytes + serialized.length > team.quota_bytes) {
        throw badRequest('该团队空间容量已满，请联系管理员扩容');
      }
    }
  }

  const document = await c.get('repos').documents.create({
    ownerId: user.id,
    type,
    title,
    sizeBytes: serialized.length,
    folderId,
    teamId,
  });
  await c.get('runtime').files.put(document.content_key, serialized, 'application/json');

  return json({ document: toPublicDocument(document, { myRole: 'owner' }) }, 201);
});

documentRoutes.get('/:id', async (c) => {
  const { document, permissions, access } = await loadAccessible(c, c.req.param('id'));
  if (!permissions.canRead) throw forbidden('没有权限访问该文档');

  const raw = await getText(c.get('runtime').files, document.content_key);
  const owner = await c.get('repos').users.getById(document.owner_id);

  // 记录「最近打开」。只有所有者自己的视角才更新，避免别人打开你的文档改变你的排序
  if (access === 'owner') {
    await c.get('repos').documents.touchOpened(document.id);
  }

  return json({
    document: toPublicDocument(document, { ownerName: owner?.display_name, myRole: access === 'none' ? undefined : access }),
    content: raw ? JSON.parse(raw) : emptyContentFor(document.type),
    access,
    // 前端据此决定「浏览模式」与按钮可用性
    permissions,
  });
});

documentRoutes.put('/:id', async (c) => {
  const { document, permissions, access } = await loadAccessible(c, c.req.param('id'));
  if (!permissions.canUpdate) throw forbidden('没有权限修改该文档');

  const body = await readJson<{ content?: unknown; title?: unknown; baseVersion?: unknown }>(
    c.req.raw
  );
  const content = normalizeDocumentContent(document.type, body.content);
  const serialized = JSON.stringify(content);
  assertContentSize(serialized);

  const baseVersion =
    typeof body.baseVersion === 'number' && Number.isFinite(body.baseVersion)
      ? body.baseVersion
      : undefined;

  // 先落内容再更新元数据：即使元数据更新失败，顶多版本号偏旧，不会丢内容
  await c.get('runtime').files.put(document.content_key, serialized, 'application/json');

  const result = await c.get('repos').documents.saveContent(document.id, {
    sizeBytes: serialized.length,
    title: optionalString(body.title, 120),
    baseVersion,
    editedBy: c.get('user')!.id,
  });

  if (result.conflict) {
    return json(
      {
        error: '文档已在其它设备被修改，请刷新后再保存',
        code: 'VERSION_CONFLICT',
        document: toPublicDocument(result.document as DocumentRecord, { myRole: access === 'none' ? undefined : access }),
      },
      409
    );
  }

  return json({
    document: toPublicDocument(result.document ?? document, { myRole: access === 'none' ? undefined : access }),
    elementCount: summarizeContent(content),
  });
});

documentRoutes.patch('/:id', async (c) => {
  const { document, permissions, access } = await loadAccessible(c, c.req.param('id'));
  if (!permissions.canUpdate) throw forbidden('没有权限修改该文档');
  const body = await readJson<{ title?: unknown; folderId?: unknown; starred?: unknown }>(c.req.raw);

  let updated: DocumentRecord | null = document;

  if (body.title !== undefined) {
    const title = requireString(body.title, 'title', { max: 120 });
    updated = await c.get('repos').documents.rename(document.id, title);
  }

  // 归档与收藏属于「所有者自己的组织方式」，协作者（editor）无权改动
  if (body.folderId !== undefined || body.starred !== undefined) {
    if (access !== 'owner') throw forbidden('只有所有者可以归档或收藏文档');
  }

  if (body.folderId !== undefined) {
    let folderId: string | null = null;
    if (body.folderId !== null && body.folderId !== undefined) {
      const raw = requireString(body.folderId, 'folderId', { max: 64, trim: true });
      folderId = raw === '' || raw === 'root' ? null : raw;
    }
    if (folderId) {
      const folder = await c.get('repos').folders.getActive(folderId);
      if (!folder || folder.owner_id !== document.owner_id) throw badRequest('目标目录不存在');
    }
    updated = await c.get('repos').documents.setFolder(document.id, folderId);
  }

  if (body.starred !== undefined) {
    updated = await c.get('repos').documents.setStarred(document.id, !!body.starred);
  }

  return json({ document: updated ? toPublicDocument(updated, { myRole: access === 'none' ? undefined : access }) : null });
});

documentRoutes.delete('/:id', async (c) => {
  const { document, permissions } = await loadAccessible(c, c.req.param('id'));
  // 团队空间里，拥有删除权限的成员也可以删除（只读模式下只有团队管理员可以）
  if (!permissions.canDelete) throw forbidden('没有删除该文档的权限');

  const permanent = c.req.query('permanent') === 'true';
  if (permanent) {
    await c.get('runtime').files.delete(document.content_key);
    await c.get('repos').members.removeAllForDocument(document.id);
    await c.get('repos').documents.hardDelete(document.id);
  } else {
    await c.get('repos').documents.softDelete(document.id);
  }
  return json({ ok: true, permanent });
});

documentRoutes.post('/:id/restore', async (c) => {
  const user = c.get('user')!;
  const document = await c.get('repos').documents.getById(c.req.param('id'));
  if (!document) throw notFound('文档不存在');
  if (document.owner_id !== user.id && user.role !== 'admin') {
    throw forbidden('只有所有者可以恢复该文档');
  }
  await c.get('repos').documents.restore(document.id);
  const updated = await c.get('repos').documents.getById(document.id);
  return json({ document: updated ? toPublicDocument(updated, { myRole: 'owner' }) : null });
});

documentRoutes.post('/:id/duplicate', async (c) => {
  const { document, access } = await loadAccessible(c, c.req.param('id'));
  if (access === 'none') throw forbidden('没有权限复制该文档');
  const user = c.get('user')!;

  const raw = await getText(c.get('runtime').files, document.content_key);
  const content = raw ?? JSON.stringify(emptyContentFor(document.type));
  const copy = await c.get('repos').documents.create({
    ownerId: user.id,
    type: document.type,
    title: `${document.title} 副本`,
    sizeBytes: content.length,
  });
  await c.get('runtime').files.put(copy.content_key, content, 'application/json');

  return json({ document: toPublicDocument(copy, { myRole: 'owner' }) }, 201);
});

// ---------------------------------------------------------------------------
// 链接分享（创建/撤销由所有者或管理员操作；访问本身走 /api/share/:token，无需登录）
// ---------------------------------------------------------------------------

documentRoutes.post('/:id/share-link', async (c) => {
  const document = await c.get('repos').documents.getActive(c.req.param('id'));
  if (!document) throw notFound('文档不存在');
  const user = c.get('user')!;
  if (document.owner_id !== user.id && user.role !== 'admin') {
    throw forbidden('只有所有者可以管理分享链接');
  }

  const body = await readJson<{ mode?: unknown }>(c.req.raw);
  const mode = requireString(body.mode, 'mode');
  if (mode !== 'view' && mode !== 'edit') throw badRequest('mode 只能是 view 或 edit');

  const { token, document: updated } = await c.get('repos').documents.setLinkShare(document.id, mode);
  return json({
    share: { token, mode, path: `/s/${token}` },
    document: updated ? toPublicDocument(updated, { myRole: 'owner' }) : null,
  });
});

documentRoutes.delete('/:id/share-link', async (c) => {
  const document = await c.get('repos').documents.getActive(c.req.param('id'));
  if (!document) throw notFound('文档不存在');
  const user = c.get('user')!;
  if (document.owner_id !== user.id && user.role !== 'admin') {
    throw forbidden('只有所有者可以管理分享链接');
  }
  const updated = await c.get('repos').documents.revokeLinkShare(document.id);
  return json({ document: updated ? toPublicDocument(updated, { myRole: 'owner' }) : null });
});

// ---------------------------------------------------------------------------
// 指定用户分享（协作成员）
// ---------------------------------------------------------------------------

documentRoutes.get('/:id/members', async (c) => {
  const document = await c.get('repos').documents.getActive(c.req.param('id'));
  if (!document) throw notFound('文档不存在');
  const user = c.get('user')!;
  if (document.owner_id !== user.id && user.role !== 'admin') {
    throw forbidden('只有所有者可以查看协作成员');
  }
  const members = await c.get('repos').members.listByDocument(document.id);
  return json({
    members: members.map((member) => ({
      userId: member.user_id,
      email: member.email,
      displayName: member.display_name,
      role: member.role,
      createdAt: member.created_at,
    })),
  });
});

documentRoutes.post('/:id/members', async (c) => {
  const document = await c.get('repos').documents.getActive(c.req.param('id'));
  if (!document) throw notFound('文档不存在');
  const actor = c.get('user')!;
  if (document.owner_id !== actor.id && actor.role !== 'admin') {
    throw forbidden('只有所有者可以添加协作成员');
  }

  const body = await readJson<{
    email?: unknown;
    role?: unknown;
    canRead?: unknown;
    canUpdate?: unknown;
  }>(c.req.raw);
  const email = requireEmail(body.email);

  // 兼容旧调用（role），新调用可直接传 canRead / canUpdate。
  // 删除权限不对协作者开放：只有所有者能删除。
  const legacyRole = typeof body.role === 'string' ? body.role : undefined;
  if (legacyRole && legacyRole !== 'viewer' && legacyRole !== 'editor') {
    throw badRequest('role 只能是 viewer 或 editor');
  }
  // 没显式指定就走「新用户默认权限」设置
  const defaults = await c.get('settings').defaultPermissions();
  const canUpdate =
    typeof body.canUpdate === 'boolean'
      ? body.canUpdate
      : legacyRole
        ? legacyRole === 'editor'
        : defaults.canUpdate;
  const canRead = typeof body.canRead === 'boolean' ? body.canRead : defaults.canRead || canUpdate;
  if (!canRead && !canUpdate) throw badRequest('至少要保留读取权限');

  const target = await c.get('repos').users.getByEmail(email);
  if (!target) throw notFound('该邮箱未注册，无法添加为协作成员', 'USER_NOT_FOUND');
  if (target.id === document.owner_id) throw badRequest('所有者无需添加为协作成员');

  await c.get('repos').members.upsert({
    documentId: document.id,
    userId: target.id,
    role: canUpdate ? 'editor' : 'viewer',
    grantedBy: actor.id,
    canRead,
    canUpdate,
  });
  return json({ ok: true });
});

documentRoutes.delete('/:id/members/:userId', async (c) => {
  const document = await c.get('repos').documents.getActive(c.req.param('id'));
  if (!document) throw notFound('文档不存在');
  const actor = c.get('user')!;
  if (document.owner_id !== actor.id && actor.role !== 'admin') {
    throw forbidden('只有所有者可以移除协作成员');
  }
  await c.get('repos').members.remove(document.id, c.req.param('userId'));
  return json({ ok: true });
});
