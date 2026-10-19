import { Hono } from 'hono';
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
  const folders = await c.get('repos').folders.list(user.id);
  return json({ folders: folders.map(toPublicFolder) });
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
