import { Hono } from 'hono';
import type { ApiEnv } from '../context';
import { assertContentSize, emptyContentFor, normalizeDocumentContent, utf8ByteLength } from '../lib/document-content';
import { getText } from '../files';
import { pendingContentKey } from '../repos/documents';
import { badRequest, forbidden, json, notFound, readJson } from '../lib/http';
import { toPublicDocument } from '../repos/types';

/**
 * 链接分享访问入口：**无需登录**。
 * - mode=view 只读
 * - mode=edit 允许匿名访客直接编辑并保存，这正是「分享给未登录用户」的落地方式
 */
export const shareRoutes = new Hono<ApiEnv>();

shareRoutes.get('/:token', async (c) => {
  const document = await c.get('repos').documents.getByLinkToken(c.req.param('token'));
  if (!document || !document.link_mode) throw notFound('分享链接无效或已关闭');

  const raw = await getText(c.get('runtime').files, document.content_key);
  const owner = await c.get('repos').users.getById(document.owner_id);

  return json({
    document: toPublicDocument(document, { ownerName: owner?.display_name }),
    content: raw ? JSON.parse(raw) : emptyContentFor(document.type),
    mode: document.link_mode,
    access: document.link_mode === 'edit' ? 'editor' : 'viewer',
  });
});

shareRoutes.put('/:token', async (c) => {
  const document = await c.get('repos').documents.getByLinkToken(c.req.param('token'));
  if (!document || !document.link_mode) throw notFound('分享链接无效或已关闭');
  if (document.link_mode !== 'edit') throw forbidden('该分享链接是只读的，无法保存');

  const body = await readJson<{ content?: unknown; baseVersion?: unknown }>(c.req.raw);
  const content = normalizeDocumentContent(document.type, body.content);
  const serialized = JSON.stringify(content);
  assertContentSize(serialized);

  const baseVersion =
    typeof body.baseVersion === 'number' && Number.isFinite(body.baseVersion)
      ? body.baseVersion
      : undefined;

  // 与登录态保存一致：先写临时 key，再由 CAS 提交切换指针
  const pendingKey = pendingContentKey(document.id);
  await c.get('runtime').files.put(pendingKey, serialized, 'application/json');
  const result = await c.get('repos').documents.commitContent(document.id, {
    sizeBytes: utf8ByteLength(serialized),
    baseVersion,
    // 匿名访客没有 userId，仅记录「最近一次是匿名编辑」
    editedBy: null,
    pendingKey,
  });

  if (result.status === 'missing') throw notFound('文档不存在或已被删除');

  if (result.status === 'conflict') {
    await c.get('runtime').files.delete(pendingKey).catch(() => undefined);
    return json(
      {
        error: '文档已在其它设备被修改，请刷新后再保存',
        code: 'VERSION_CONFLICT',
        document: toPublicDocument(result.document!),
      },
      409
    );
  }

  if (result.document && result.document.content_key !== document.content_key) {
    await c.get('runtime').files.delete(document.content_key).catch(() => undefined);
  }

  return json({ document: toPublicDocument(result.document ?? document), mode: document.link_mode });
});

shareRoutes.post('/:token/claim', async (c) => {
  const user = c.get('user');
  if (!user) throw badRequest('请先登录后再认领此文档', 'UNAUTHORIZED');
  const document = await c.get('repos').documents.getByLinkToken(c.req.param('token'));
  if (!document || !document.link_mode) throw notFound('分享链接无效或已关闭');
  if (document.owner_id === user.id) return json({ ok: true, alreadyOwner: true });

  await c.get('repos').members.upsert({
    documentId: document.id,
    userId: user.id,
    role: document.link_mode === 'edit' ? 'editor' : 'viewer',
    grantedBy: document.owner_id,
  });
  return json({ ok: true });
});
