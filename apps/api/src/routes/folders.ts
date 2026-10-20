import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ApiEnv } from '../context';
import {
  badRequest,
  forbidden,
  json,
  notFound,
  readJson,
  requireString,
} from '../lib/http';
import { requireAuth } from '../middleware';
import { toPublicFolder } from '../repos/types';

/**
 * 目录（文件夹）接口。目录只属于创建者，用于组织自己的文档，
 * 不参与分享——分享的粒度是文档。
 */
export const folderRoutes = new Hono<ApiEnv>();
folderRoutes.use('*', requireAuth);

folderRoutes.get('/', async (c) => {
  const user = c.get('user')!;
  const [own, shared] = await Promise.all([
    c.get('repos').folders.list(user.id),
    c.get('repos').folderMembers.listSharedWithUser(user.id),
  ]);

  return json({
    folders: [
      ...own.map((folder) => ({ ...toPublicFolder(folder), shared: false })),
      // 分享给我的目录：带上我在这份分享里的权限，前端据此隐藏不允许的操作
      ...shared.map((row) => ({
        id: row.folder_id,
        name: row.name,
        parentId: row.parent_id,
        ownerId: row.owner_id,
        updatedAt: row.updated_at,
        shared: true,
        permissions: {
          canCreate: !!row.can_create,
          canRead: !!row.can_read,
          canUpdate: !!row.can_update,
          canDelete: !!row.can_delete,
        },
      })),
    ],
  });
});

folderRoutes.post('/', async (c) => {
  const user = c.get('user')!;
  const body = await readJson<{ name?: unknown; parentId?: unknown }>(c.req.raw);
  const name = requireString(body.name, 'name', { max: 60 });

  let parentId: string | null = null;
  if (typeof body.parentId === 'string' && body.parentId.trim()) {
    const parent = await c.get('repos').folders.getActive(body.parentId.trim());
    if (!parent || parent.owner_id !== user.id) throw badRequest('父目录不存在');
    parentId = parent.id;
  }

  const folder = await c.get('repos').folders.create({ ownerId: user.id, name, parentId });
  return json({ folder: toPublicFolder(folder) }, 201);
});

folderRoutes.patch('/:id', async (c) => {
  const user = c.get('user')!;
  const folder = await c.get('repos').folders.getActive(c.req.param('id'));
  if (!folder) throw notFound('目录不存在');
  if (folder.owner_id !== user.id) throw forbidden('没有权限修改该目录');

  const body = await readJson<{ name?: unknown; parentId?: unknown }>(c.req.raw);
  let updated = folder;

  if (body.name !== undefined) {
    const name = requireString(body.name, 'name', { max: 60 });
    updated = (await c.get('repos').folders.rename(folder.id, name)) ?? updated;
  }

  if (body.parentId !== undefined) {
    const nextParentId =
      body.parentId === null
        ? null
        : requireString(body.parentId, 'parentId', { max: 64, trim: true }) || null;

    if (nextParentId) {
      const parent = await c.get('repos').folders.getActive(nextParentId);
      if (!parent || parent.owner_id !== user.id) throw badRequest('父目录不存在');
      // 不能移动到自己或自己的子目录下，否则会形成环
      if (await c.get('repos').folders.isInSubtree(folder.id, nextParentId)) {
        throw badRequest('不能把目录移动到它自己或它的子目录下');
      }
    }

    updated = (await c.get('repos').folders.move(folder.id, nextParentId)) ?? updated;
  }

  return json({ folder: toPublicFolder(updated) });
});

// ---------------------------------------------------------------------------
// 目录分享：只有目录所有者（或管理员）能管理授权
// ---------------------------------------------------------------------------

async function requireFolderOwner(c: Context<ApiEnv>) {
  const user = c.get('user')!;
  const folder = await c.get('repos').folders.getActive(c.req.param('id')!);
  if (!folder) throw notFound('目录不存在');
  if (folder.owner_id !== user.id && user.role !== 'admin') {
    throw forbidden('只有目录所有者可以管理分享');
  }
  return folder;
}

folderRoutes.get('/:id/members', async (c) => {
  const folder = await requireFolderOwner(c);
  const rows = await c.get('repos').folderMembers.listByFolder(folder.id);
  return json({
    members: rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      canCreate: !!row.can_create,
      canRead: !!row.can_read,
      canUpdate: !!row.can_update,
      canDelete: !!row.can_delete,
    })),
  });
});

folderRoutes.post('/:id/members', async (c) => {
  const folder = await requireFolderOwner(c);
  const body = await readJson<{
    email?: unknown;
    canCreate?: unknown;
    canRead?: unknown;
    canUpdate?: unknown;
    canDelete?: unknown;
  }>(c.req.raw);
  const email = requireString(body.email, 'email', { max: 200 });
  const target = await c.get('repos').users.getByEmail(email.trim().toLowerCase());
  if (!target) throw notFound('该邮箱未注册，无法分享', 'USER_NOT_FOUND');
  if (target.id === folder.owner_id) throw badRequest('所有者无需添加');

  const bool = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback;

  await c.get('repos').folderMembers.upsert({
    folderId: folder.id,
    userId: target.id,
    canCreate: bool(body.canCreate, false),
    canRead: bool(body.canRead, true),
    canUpdate: bool(body.canUpdate, false),
    canDelete: bool(body.canDelete, false),
    grantedBy: c.get('user')!.id,
  });
  return json({ ok: true });
});

folderRoutes.delete('/:id/members/:userId', async (c) => {
  const folder = await requireFolderOwner(c);
  await c.get('repos').folderMembers.remove(folder.id, c.req.param('userId'));
  return json({ ok: true });
});

folderRoutes.delete('/:id', async (c) => {
  const user = c.get('user')!;
  const folder = await c.get('repos').folders.getActive(c.req.param('id'));
  if (!folder) throw notFound('目录不存在');
  if (folder.owner_id !== user.id) throw forbidden('没有权限删除该目录');

  // 不级联删除数据：其中的文档挪到父目录，子目录上提到父级
  await c.get('repos').documents.reassignFolder(folder.id, folder.parent_id);
  await c.get('repos').folders.reparentChildren(folder.id, folder.parent_id);
  await c.get('repos').folders.softDelete(folder.id);

  return json({ ok: true });
});
