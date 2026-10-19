import { Hono } from 'hono';
import { randomId } from '../lib/crypto';
import { resolveDocumentAccess, canRead } from '../lib/access';
import { badRequest, forbidden, json, notFound } from '../lib/http';
import type { ApiEnv } from '../context';
import { assetFileKey } from '../repos/assets';

export const assetRoutes = new Hono<ApiEnv>();

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/x-icon',
]);

function extensionFor(contentType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
  };
  return map[contentType] ?? 'bin';
}

/**
 * 上传内嵌图片（Markdown / Word 编辑器用）。
 * 支持两种授权方式：
 * - 已登录：按文档写权限校验（所有者 / 协作编辑者）
 * - 未登录但持有 shareToken：仅当对应文档的链接分享模式为 edit 时允许
 */
assetRoutes.post('/', async (c) => {
  const form = await c.req.parseBody();
  const file = form['file'];
  if (!(file instanceof File)) throw badRequest('缺少文件字段 file');

  const policy = await c.get('settings').uploadPolicy();
  if (!policy.allowImage) throw forbidden('管理员已关闭图片上传');

  const limit = Math.min(MAX_ASSET_BYTES, policy.maxImageBytes);
  if (file.size > limit) {
    throw badRequest(`文件过大（上限 ${(limit / 1024 / 1024).toFixed(1)}MB）`);
  }
  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_TYPES.has(contentType)) {
    throw badRequest('只支持上传图片（PNG/JPEG/GIF/WEBP/SVG/BMP/ICO）');
  }

  const documentId = typeof form['documentId'] === 'string' ? form['documentId'] : null;
  const shareToken = typeof form['shareToken'] === 'string' ? form['shareToken'] : null;
  const user = c.get('user');

  let ownerId: string | null = null;
  let boundDocumentId: string | null = null;

  if (shareToken) {
    const document = await c.get('repos').documents.getByLinkToken(shareToken);
    if (!document || document.link_mode !== 'edit') {
      throw forbidden('该分享链接不允许上传文件');
    }
    boundDocumentId = document.id;
  } else {
    if (!user) throw forbidden('请先登录');
    if (documentId) {
      const document = await c.get('repos').documents.getActive(documentId);
      if (!document) throw notFound('文档不存在');
      const memberRole = await c.get('repos').members.getRole(documentId, user.id);
      const access = resolveDocumentAccess({ document, user, memberRole });
      if (access !== 'owner' && access !== 'editor') throw forbidden('没有权限向该文档上传文件');
      boundDocumentId = document.id;
    }
    ownerId = user.id;
  }

  const id = randomId('a');
  const fileKey = assetFileKey(id, extensionFor(contentType));
  const buffer = await file.arrayBuffer();
  await c.get('runtime').files.put(fileKey, buffer, contentType);

  const asset = await c.get('repos').assets.create({
    documentId: boundDocumentId,
    ownerId,
    kind: 'image',
    contentType,
    sizeBytes: file.size,
    fileKey,
  });

  return json({ asset: { id: asset.id, url: `/api/assets/${asset.id}`, contentType, sizeBytes: file.size } }, 201);
});

/**
 * 素材库：当前用户上传过的图片。
 * 图片编辑器与演示文稿的「从素材库选择」共用这一个接口。
 */
assetRoutes.get('/', async (c) => {
  const user = c.get('user');
  if (!user) throw forbidden('请先登录');

  const rawLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
  const rawOffset = Number.parseInt(c.req.query('offset') ?? '', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 60;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const [items, total] = await Promise.all([
    c.get('repos').assets.listByOwner(user.id, limit, offset),
    c.get('repos').assets.countByOwner(user.id),
  ]);

  return json({
    assets: items.map((asset) => ({
      id: asset.id,
      url: `/api/assets/${asset.id}`,
      contentType: asset.content_type,
      sizeBytes: asset.size_bytes,
      createdAt: asset.created_at,
    })),
    total,
  });
});

/**
 * 下载/预览资源。资源 id 是 128 位随机值，天然具备「不可猜测令牌」属性，
 * 因此只要文档处于任意链接分享状态即放行查看——这与业界常见的「知道链接即可访问」
 * 分享模型一致（成员/所有者走正常权限判断）。
 */
assetRoutes.get('/:id', async (c) => {
  const asset = await c.get('repos').assets.getById(c.req.param('id'));
  if (!asset) throw notFound('文件不存在');

  if (asset.document_id) {
    const document = await c.get('repos').documents.getActive(asset.document_id);
    if (!document) throw notFound('文件不存在');
    const user = c.get('user');
    const memberRole = user ? await c.get('repos').members.getRole(document.id, user.id) : null;
    const access = resolveDocumentAccess({
      document,
      user,
      memberRole,
      viaLinkMode: document.link_mode,
    });
    if (!canRead(access)) throw forbidden('没有权限访问该文件');
  } else if (asset.owner_id) {
    const user = c.get('user');
    if (!user || (user.id !== asset.owner_id && user.role !== 'admin')) {
      throw forbidden('没有权限访问该文件');
    }
  }

  const data = await c.get('runtime').files.get(asset.file_key);
  if (!data) throw notFound('文件内容已丢失');

  return new Response(data, {
    headers: {
      'Content-Type': asset.content_type,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
});

assetRoutes.delete('/:id', async (c) => {
  const asset = await c.get('repos').assets.getById(c.req.param('id'));
  if (!asset) return json({ ok: true });
  const user = c.get('user');
  if (!user) throw forbidden('请先登录');

  if (asset.document_id) {
    const document = await c.get('repos').documents.getActive(asset.document_id);
    if (document && document.owner_id !== user.id && user.role !== 'admin') {
      throw forbidden('没有权限删除该文件');
    }
  } else if (asset.owner_id && asset.owner_id !== user.id && user.role !== 'admin') {
    throw forbidden('没有权限删除该文件');
  }

  await c.get('runtime').files.delete(asset.file_key);
  await c.get('repos').assets.remove(asset.id);
  return json({ ok: true });
});
