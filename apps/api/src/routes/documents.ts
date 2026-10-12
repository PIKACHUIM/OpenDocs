import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ApiEnv } from '../context';
import { canWrite, resolveDocumentAccess } from '../lib/access';
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
} from '../repos/types';

export const documentRoutes = new Hono<ApiEnv>();
documentRoutes.use('*', requireAuth);

const DOCUMENT_TYPES: DocumentType[] = ['mindmap', 'markdown', 'word', 'excel', 'ppt'];

function assertType(type: unknown): DocumentType {
  if (typeof type !== 'string' || !DOCUMENT_TYPES.includes(type as DocumentType)) {
    throw badRequest(`type 必须是 ${DOCUMENT_TYPES.join('/')} 之一`);
  }
  return type as DocumentType;
}

async function loadAccessible(c: Context<ApiEnv>, id: string) {
  const document = await c.get('repos').documents.getActive(id);
  if (!document) throw notFound('文档不存在或已被删除');
  const user = c.get('user')!;
  const memberRole = await c.get('repos').members.getRole(id, user.id);
  const access = resolveDocumentAccess({ document, user, memberRole });
  return { document, access };
}

documentRoutes.get('/', async (c) => {
  const user = c.get('user')!;
  const scope = c.req.query('scope') === 'shared' ? 'shared' : 'owned';
  const { page, pageSize } = paging(c.req.query('page'), c.req.query('pageSize'));
  const query = optionalString(c.req.query('q'), 200);
  const type = c.req.query('type');
  const trashed = c.req.query('trashed') === 'true';

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

  const result = await c.get('repos').documents.listOwned(user.id, {
    page,
    pageSize,
    query,
    type: type ? assertType(type) : undefined,
    trashed,
  });
  return json({
    documents: result.items.map((item) => toPublicDocument(item, { myRole: 'owner' })),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });
});

documentRoutes.post('/', async (c) => {
  const user = c.get('user')!;
  const body = await readJson<{ type?: unknown; title?: unknown; content?: unknown }>(c.req.raw);
  const type = assertType(body.type);
  const title = optionalString(body.title, 120) ?? '未命名文档';

  const content = normalizeDocumentContent(type, body.content ?? emptyContentFor(type));
  const serialized = JSON.stringify(content);
  assertContentSize(serialized);

  const document = await c.get('repos').documents.create({
    ownerId: user.id,
    type,
    title,
    sizeBytes: serialized.length,
  });
  await c.get('runtime').files.put(document.content_key, serialized, 'application/json');

  return json({ document: toPublicDocument(document, { myRole: 'owner' }) }, 201);
});

documentRoutes.get('/:id', async (c) => {
  const { document, access } = await loadAccessible(c, c.req.param('id'));
  if (access === 'none') throw forbidden('没有权限访问该文档');

  const raw = await getText(c.get('runtime').files, document.content_key);
  const owner = await c.get('repos').users.getById(document.owner_id);

  return json({
    document: toPublicDocument(document, { ownerName: owner?.display_name, myRole: access }),
    content: raw ? JSON.parse(raw) : emptyContentFor(document.type),
    access,
  });
});

documentRoutes.put('/:id', async (c) => {
  const { document, access } = await loadAccessible(c, c.req.param('id'));
  if (!canWrite(access)) throw forbidden('没有权限修改该文档');

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
        document: toPublicDocument(result.document as DocumentRecord, { myRole: access }),
      },
      409
    );
  }

  return json({
    document: toPublicDocument(result.document ?? document, { myRole: access }),
    elementCount: summarizeContent(content),
  });
});

documentRoutes.patch('/:id', async (c) => {
  const { document, access } = await loadAccessible(c, c.req.param('id'));
  if (!canWrite(access)) throw forbidden('没有权限修改该文档');
  const body = await readJson<{ title?: unknown }>(c.req.raw);
  const title = requireString(body.title, 'title', { max: 120 });
  const updated = await c.get('repos').documents.rename(document.id, title);
  return json({ document: updated ? toPublicDocument(updated, { myRole: access }) : null });
});

documentRoutes.delete('/:id', async (c) => {
  const { document, access } = await loadAccessible(c, c.req.param('id'));
  if (access !== 'owner') throw forbidden('只有所有者可以删除该文档');

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

  const body = await readJson<{ email?: unknown; role?: unknown }>(c.req.raw);
  const email = requireEmail(body.email);
  const role = requireString(body.role, 'role');
  if (role !== 'viewer' && role !== 'editor') throw badRequest('role 只能是 viewer 或 editor');

  const target = await c.get('repos').users.getByEmail(email);
  if (!target) throw notFound('该邮箱未注册，无法添加为协作成员', 'USER_NOT_FOUND');
  if (target.id === document.owner_id) throw badRequest('所有者无需添加为协作成员');

  await c.get('repos').members.upsert({
    documentId: document.id,
    userId: target.id,
    role,
    grantedBy: actor.id,
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
