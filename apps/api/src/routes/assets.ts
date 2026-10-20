import { Hono } from 'hono';
import { randomId } from '../lib/crypto';
import { resolvePermissions } from '../lib/access';
import {
  badRequest,
  clientIp,
  forbidden,
  json,
  notFound,
  tooLarge,
} from '../lib/http';
import type { ApiEnv } from '../context';
import { RATE_LIMITS, enforceRateLimit } from '../lib/rate-limit';
import { assetFileKey } from '../repos/assets';
import type { PermissionSet } from '../repos/types';

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
 * 按文件头判断真实类型。
 *
 * 只信 `file.type` 是不行的：multipart 里的 Content-Type 完全由客户端决定，
 * 把 HTML 声明成 image/png 就能绕过白名单。这里对位图做魔数校验，
 * SVG 则按文本内容单独审查。
 */
function sniffType(bytes: Uint8Array): string | null {
  const at = (offset: number, signature: number[]) =>
    signature.every((value, index) => bytes[offset + index] === value);

  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at(0, [0x42, 0x4d])) return 'image/bmp';
  if (at(0, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}

/**
 * SVG 里可以塞脚本：直接以同源 URL 打开就是一个存储型 XSS。
 *
 * 边缘运行时没有 DOM/DOMPurify，做不了完整解析，这里采用「危险特征一律拒绝」：
 * 正常绘图工具导出的 SVG 只包含 path/rect/g/text/style，不依赖脚本或外部实体。
 */
const DANGEROUS_SVG =
  /<\s*(script|foreignObject|iframe|object|embed|audio|video|animate|set|handler)\b|on[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html|<!ENTITY|<!DOCTYPE[^>]*\[/i;

function assertSvgSafe(text: string) {
  if (DANGEROUS_SVG.test(text)) {
    throw badRequest(
      'SVG 包含脚本或可执行内容，已拒绝上传；请从绘图工具重新导出为不含脚本的 SVG/PNG',
      'UNSAFE_SVG'
    );
  }
}

/** 下载时的安全响应头：即使内容有问题，浏览器也不会把它当同源文档执行 */
function assetHeaders(contentType: string, filename: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    // sandbox 指令对 SVG/HTML 文档生效，脚本一律不执行；位图不受影响
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `inline; filename="${filename}"`,
    // 不再 immutable 一年：撤销分享/删除后要能尽快失效
    'Cache-Control': 'private, max-age=300, must-revalidate',
  };
}

/**
 * 上传内嵌图片（Markdown / Word 编辑器用）。
 * 支持两种授权方式：
 * - 已登录：按文档写权限校验（所有者 / 协作编辑者）
 * - 未登录但持有 shareToken：仅当对应文档的链接分享模式为 edit 时允许
 */
assetRoutes.post('/', async (c) => {
  const policy = await c.get('settings').uploadPolicy();
  if (!policy.allowImage) throw forbidden('管理员已关闭图片上传');

  const limit = Math.min(MAX_ASSET_BYTES, policy.maxImageBytes);
  // 解析 multipart 前先按 Content-Length 拦住超大请求（留 1MB 表单开销余量）
  const declared = Number.parseInt(c.req.header('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > limit + 1024 * 1024) {
    throw tooLarge('请求体过大');
  }

  const form = await c.req.parseBody();
  const file = form['file'];
  if (!(file instanceof File)) throw badRequest('缺少文件字段 file');

  if (file.size > limit) {
    throw badRequest(`文件过大（上限 ${(limit / 1024 / 1024).toFixed(1)}MB）`);
  }
  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_TYPES.has(contentType)) {
    throw badRequest('只支持上传图片（PNG/JPEG/GIF/WEBP/SVG/BMP/ICO）');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (contentType === 'image/svg+xml') {
    const text = new TextDecoder().decode(bytes);
    if (!/<svg[\s>]/i.test(text)) throw badRequest('不是合法的 SVG 文件');
    assertSvgSafe(text);
  } else {
    const sniffed = sniffType(bytes);
    if (sniffed !== contentType) {
      throw badRequest('文件内容与声明的图片类型不一致，已拒绝上传', 'TYPE_MISMATCH');
    }
  }

  const documentId = typeof form['documentId'] === 'string' ? form['documentId'] : null;
  const shareToken = typeof form['shareToken'] === 'string' ? form['shareToken'] : null;
  const user = c.get('user');
  const ip = clientIp((name) => c.req.header(name)) ?? 'unknown';

  let ownerId: string | null = null;
  let boundDocumentId: string | null = null;
  let teamId: string | null = null;

  if (shareToken) {
    // 匿名（持有 edit 分享链接）上传：按 IP 限流，避免被当成免费图床
    enforceRateLimit(`upload:ip:${ip}`, RATE_LIMITS.uploadIp);
    const document = await c.get('repos').documents.getByLinkToken(shareToken);
    if (!document || document.link_mode !== 'edit') {
      throw forbidden('该分享链接不允许上传文件');
    }
    boundDocumentId = document.id;
    teamId = document.team_id;
  } else {
    if (!user) throw forbidden('请先登录');
    enforceRateLimit(`upload:user:${user.id}`, RATE_LIMITS.uploadUser);
    enforceRateLimit(`upload:ip:${ip}`, RATE_LIMITS.uploadIp);
    if (documentId) {
      const document = await c.get('repos').documents.getActive(documentId);
      if (!document) throw notFound('文档不存在');
      const memberRole = await c.get('repos').members.getRole(documentId, user.id);
      const permissions = resolvePermissions({
        document,
        user,
        memberRole,
      });
      if (!permissions.canUpdate) throw forbidden('没有权限向该文档上传文件');
      boundDocumentId = document.id;
      teamId = document.team_id;
    }
    ownerId = user.id;
  }

  const repos = c.get('repos');

  // 团队空间的图片开关与配额（之前完全没校验，团队策略形同虚设）
  if (teamId) {
    const team = await repos.teams.getById(teamId);
    if (team) {
      if (!team.allow_image) throw forbidden('该团队空间已关闭图片上传');
      if (team.max_image_bytes > 0 && file.size > team.max_image_bytes) {
        throw badRequest(
          `文件超过该空间的单图上限（${(team.max_image_bytes / 1024 / 1024).toFixed(1)}MB）`
        );
      }
      if (team.quota_bytes > 0 && boundDocumentId) {
        const [stats, assetBytes] = await Promise.all([
          repos.teams.stats(team.id),
          repos.assets.sumSizeByDocument(boundDocumentId),
        ]);
        if (stats.usedBytes + assetBytes + file.size > team.quota_bytes) {
          throw badRequest('该团队空间容量已满，请联系管理员扩容');
        }
      }
    }
  }

  // 用户配额与全站配额
  if (ownerId && policy.userQuotaBytes > 0) {
    const used = await repos.assets.sumSizeByOwner(ownerId);
    if (used + file.size > policy.userQuotaBytes) {
      throw badRequest('个人存储空间已满，请清理素材库后再上传');
    }
  }
  if (policy.systemQuotaBytes > 0) {
    const total = await repos.assets.sumAllSize();
    if (total + file.size > policy.systemQuotaBytes) {
      throw forbidden('全站存储空间已满，请联系管理员');
    }
  }

  const id = randomId('a');
  const fileKey = assetFileKey(id, extensionFor(contentType));
  await c.get('runtime').files.put(fileKey, bytes, contentType);

  const asset = await repos.assets.create({
    documentId: boundDocumentId,
    ownerId,
    kind: 'image',
    contentType,
    sizeBytes: file.size,
    fileKey,
  });

  return json(
    { asset: { id: asset.id, url: `/api/assets/${asset.id}`, contentType, sizeBytes: file.size } },
    201
  );
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
 * 下载/预览资源。
 * 资源 id 是 128 位随机值，天然具备「不可猜测令牌」属性：
 * 成员/所有者走正常权限判断，文档处于链接分享状态时按分享模式放行。
 */
assetRoutes.get('/:id', async (c) => {
  const asset = await c.get('repos').assets.getById(c.req.param('id'));
  if (!asset) throw notFound('文件不存在');
  const user = c.get('user');

  if (asset.document_id) {
    const repos = c.get('repos');
    const document = await repos.documents.getActive(asset.document_id);
    if (!document) throw notFound('文件不存在');

    // 与文档详情用同一套权限：文件 > 空间 > 目录 > 链接分享
    const documentPermissions: PermissionSet | null = user
      ? await repos.members.getPermissions(document.id, user.id)
      : null;
    let teamPermissions: (PermissionSet & { isAdmin?: boolean }) | null = null;
    let teamReadonly = false;
    if (document.team_id && user) {
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
    if (document.folder_id && user) {
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
      viaLinkMode: document.link_mode,
    });
    if (!permissions.canRead) throw forbidden('没有权限访问该文件');
  } else if (asset.owner_id) {
    if (!user || (user.id !== asset.owner_id && user.role !== 'admin')) {
      throw forbidden('没有权限访问该文件');
    }
  }

  const data = await c.get('runtime').files.get(asset.file_key);
  if (!data) throw notFound('文件内容已丢失');

  return new Response(data, {
    headers: assetHeaders(asset.content_type, `${asset.id}.${extensionFor(asset.content_type)}`),
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
