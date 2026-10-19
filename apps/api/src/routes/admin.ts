import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ApiEnv } from '../context';
import { hashPassword, type PasswordHash } from '../lib/crypto';
import { getText } from '../files';
import { badRequest, conflict, json, notFound, readJson, requireString } from '../lib/http';
import { requireAdmin } from '../middleware';
import { toPublicInviteCode } from '../repos/types';
import { paging } from '../db/sql';
import { SETTINGS_KEYS } from '../services/settings';
import { emptyContentFor } from '../lib/document-content';
import {
  toPublicDocument,
  toPublicUser,
  type DocumentType,
  type UserRecord,
  type UserRole,
} from '../repos/types';

export const adminRoutes = new Hono<ApiEnv>();
adminRoutes.use('*', requireAdmin);

async function countActiveAdmins(c: Context<ApiEnv>): Promise<number> {
  return c.get('repos').users.countAdmins();
}

adminRoutes.get('/stats', async (c) => {
  const [userCount, adminCount, docStats] = await Promise.all([
    c.get('repos').users.count(),
    countActiveAdmins(c),
    c.get('repos').documents.stats(),
  ]);
  return json({
    storage: c.get('runtime').platform,
    users: { total: userCount, admins: adminCount },
    documents: docStats,
  });
});

adminRoutes.get('/users', async (c) => {
  const { page, pageSize } = paging(c.req.query('page'), c.req.query('pageSize'));
  const query = c.req.query('q')?.trim() || undefined;
  const result = await c.get('repos').users.list({ page, pageSize, query });

  const users: UserRecord[] = result.items;
  const counts = await Promise.all(users.map((user) => c.get('repos').documents.countByOwner(user.id)));

  return json({
    users: users.map((user, index) => ({ ...toPublicUser(user), documentCount: counts[index] })),
    total: result.total,
    page,
    pageSize,
  });
});

adminRoutes.patch('/users/:id', async (c) => {
  const target = await c.get('repos').users.getById(c.req.param('id'));
  if (!target) throw notFound('用户不存在');
  const actor = c.get('user')!;

  const body = await readJson<{
    role?: unknown;
    disabled?: unknown;
    displayName?: unknown;
    password?: unknown;
    emailVerified?: unknown;
  }>(c.req.raw);

  const patch: {
    displayName?: string;
    role?: UserRole;
    disabled?: boolean;
    emailVerified?: boolean;
    password?: PasswordHash;
  } = {};

  if (typeof body.displayName === 'string') {
    patch.displayName = body.displayName.trim().slice(0, 60) || target.display_name;
  }
  if (body.role !== undefined) {
    if (body.role !== 'user' && body.role !== 'admin') throw badRequest('role 只能是 user 或 admin');
    if (body.role !== 'admin' && target.role === 'admin' && (await countActiveAdmins(c)) <= 1) {
      throw conflict('至少需要保留一个管理员');
    }
    patch.role = body.role;
  }
  if (body.disabled !== undefined) {
    if (typeof body.disabled !== 'boolean') throw badRequest('disabled 必须是布尔值');
    if (body.disabled && target.id === actor.id) throw conflict('不能禁用当前登录的账号');
    if (body.disabled && target.role === 'admin' && (await countActiveAdmins(c)) <= 1) {
      throw conflict('至少需要保留一个可用管理员');
    }
    patch.disabled = body.disabled;
  }
  if (body.emailVerified !== undefined) {
    patch.emailVerified = !!body.emailVerified;
  }
  if (body.password !== undefined) {
    const password = requireString(body.password, 'password', { min: 8, max: 200, trim: false });
    patch.password = await hashPassword(password);
  }

  const updated = await c.get('repos').users.update(target.id, patch);
  if (updated && (patch.disabled || patch.password)) {
    await c.get('repos').sessions.removeByUser(updated.id);
  }
  return json({ user: updated ? toPublicUser(updated) : null });
});

adminRoutes.delete('/users/:id', async (c) => {
  const target = await c.get('repos').users.getById(c.req.param('id'));
  if (!target) throw notFound('用户不存在');
  const actor = c.get('user')!;
  if (target.id === actor.id) throw conflict('不能删除当前登录的账号');
  if (target.role === 'admin' && (await countActiveAdmins(c)) <= 1) {
    throw conflict('至少需要保留一个管理员');
  }

  const owned = await c.get('repos').documents.listAll({
    page: 1,
    pageSize: 500,
    ownerId: target.id,
    includeTrashed: true,
  });
  for (const document of owned.items) {
    await c.get('runtime').files.delete(document.content_key).catch(() => undefined);
    await c.get('repos').members.removeAllForDocument(document.id);
    await c.get('repos').documents.hardDelete(document.id);
  }
  await c.get('repos').sessions.removeByUser(target.id);
  await c.get('repos').users.remove(target.id);

  return json({ ok: true, removedDocuments: owned.items.length });
});

adminRoutes.get('/documents', async (c) => {
  const { page, pageSize } = paging(c.req.query('page'), c.req.query('pageSize'));
  const query = c.req.query('q')?.trim() || undefined;
  const type = c.req.query('type') as DocumentType | undefined;
  const includeTrashed = c.req.query('trashed') === 'true';

  const result = await c.get('repos').documents.listAll({ page, pageSize, query, type, includeTrashed });
  const ownerIds = Array.from(new Set(result.items.map((item) => item.owner_id)));
  const owners = await Promise.all(ownerIds.map((id) => c.get('repos').users.getById(id)));
  const ownerMap = new Map(ownerIds.map((id, index) => [id, owners[index]]));

  return json({
    documents: result.items.map((item) =>
      toPublicDocument(item, { ownerName: ownerMap.get(item.owner_id)?.display_name })
    ),
    total: result.total,
    page,
    pageSize,
  });
});

adminRoutes.get('/documents/:id', async (c) => {
  const document = await c.get('repos').documents.getById(c.req.param('id'));
  if (!document) throw notFound('文档不存在');
  const raw = await getText(c.get('runtime').files, document.content_key);
  const owner = await c.get('repos').users.getById(document.owner_id);
  return json({
    document: toPublicDocument(document, { ownerName: owner?.display_name }),
    content: raw ? JSON.parse(raw) : emptyContentFor(document.type),
  });
});

adminRoutes.delete('/documents/:id', async (c) => {
  const document = await c.get('repos').documents.getById(c.req.param('id'));
  if (!document) throw notFound('文档不存在');
  await c.get('runtime').files.delete(document.content_key).catch(() => undefined);
  await c.get('repos').members.removeAllForDocument(document.id);
  await c.get('repos').documents.hardDelete(document.id);
  return json({ ok: true });
});

// ---------------------------------------------------------------------------
// 系统设置：注册开关、Resend、Turnstile
// ---------------------------------------------------------------------------

adminRoutes.get('/settings', async (c) => {
  return json(await c.get('settings').adminConfig());
});

adminRoutes.patch('/settings', async (c) => {
  const body = await readJson<{
    siteName?: unknown;
    siteUrl?: unknown;
    allowRegistration?: unknown;
    inviteRequired?: unknown;
    trashRetentionDays?: unknown;
    uploadAllowImage?: unknown;
    uploadAllowFile?: unknown;
    uploadMaxImageBytes?: unknown;
    uploadMaxFileBytes?: unknown;
    quotaUserBytes?: unknown;
    quotaSystemBytes?: unknown;
    resendApiKey?: unknown;
    resendFrom?: unknown;
    turnstileEnabled?: unknown;
    turnstileSiteKey?: unknown;
    turnstileSecretKey?: unknown;
  }>(c.req.raw);

  const settings = c.get('repos').settings;
  const entries: Record<string, string> = {};
  const removals: string[] = [];

  const setOrClear = (key: string, value: unknown) => {
    if (value === null) {
      removals.push(key);
    } else if (typeof value === 'string') {
      entries[key] = value;
    }
  };

  // 上传开关
  if (typeof body.uploadAllowImage === 'boolean') {
    entries[SETTINGS_KEYS.uploadAllowImage] = body.uploadAllowImage ? 'true' : 'false';
  }
  if (typeof body.uploadAllowFile === 'boolean') {
    entries[SETTINGS_KEYS.uploadAllowFile] = body.uploadAllowFile ? 'true' : 'false';
  }

  // 体积与配额（前端以字节提交）
  const byteFields: Array<[unknown, string, number]> = [
    [body.uploadMaxImageBytes, SETTINGS_KEYS.uploadMaxImageBytes, 1],
    [body.uploadMaxFileBytes, SETTINGS_KEYS.uploadMaxFileBytes, 1],
    [body.quotaUserBytes, SETTINGS_KEYS.quotaUserBytes, 0],
    [body.quotaSystemBytes, SETTINGS_KEYS.quotaSystemBytes, 0],
  ];
  for (const [raw, key, min] of byteFields) {
    if (raw === undefined) continue;
    const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isFinite(value) || value < min) throw badRequest('容量设置不合法');
    entries[key] = String(Math.floor(value));
  }

  setOrClear(SETTINGS_KEYS.siteName, body.siteName);
  setOrClear(SETTINGS_KEYS.siteUrl, body.siteUrl);
  if (typeof body.allowRegistration === 'boolean') {
    entries[SETTINGS_KEYS.allowRegistration] = body.allowRegistration ? 'true' : 'false';
  }
  if (typeof body.inviteRequired === 'boolean') {
    entries[SETTINGS_KEYS.inviteRequired] = body.inviteRequired ? 'true' : 'false';
  }
  if (body.trashRetentionDays !== undefined) {
    const days =
      typeof body.trashRetentionDays === 'number'
        ? body.trashRetentionDays
        : Number.parseInt(String(body.trashRetentionDays), 10);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      throw badRequest('删除文档保留时长需在 1–365 天之间');
    }
    entries[SETTINGS_KEYS.trashRetentionDays] = String(Math.floor(days));
  }
  // 密钥字段：传空字符串视为「清除」，避免管理员不小心把真实密钥存成空串
  if (body.resendApiKey !== undefined) {
    const value = body.resendApiKey;
    if (value === null || value === '') removals.push(SETTINGS_KEYS.resendApiKey);
    else if (typeof value === 'string') entries[SETTINGS_KEYS.resendApiKey] = value;
  }
  setOrClear(SETTINGS_KEYS.resendFrom, body.resendFrom);
  if (typeof body.turnstileEnabled === 'boolean') {
    entries[SETTINGS_KEYS.turnstileEnabled] = body.turnstileEnabled ? 'true' : 'false';
  }
  setOrClear(SETTINGS_KEYS.turnstileSiteKey, body.turnstileSiteKey);
  if (body.turnstileSecretKey !== undefined) {
    const value = body.turnstileSecretKey;
    if (value === null || value === '') removals.push(SETTINGS_KEYS.turnstileSecretKey);
    else if (typeof value === 'string') entries[SETTINGS_KEYS.turnstileSecretKey] = value;
  }

  await settings.setMany(entries);
  for (const key of removals) await settings.remove(key);

  return json(await c.get('settings').adminConfig());
});

// ---------------------------------------------------------------------------
// 邀请码管理
// ---------------------------------------------------------------------------

adminRoutes.get('/invites', async (c) => {
  const invites = await c.get('repos').invites.list();
  return json({ invites: invites.map((item) => toPublicInviteCode(item)) });
});

adminRoutes.post('/invites', async (c) => {
  const body = await readJson<{
    code?: unknown;
    maxUses?: unknown;
    expiresAt?: unknown;
    note?: unknown;
  }>(c.req.raw);

  const maxUses =
    typeof body.maxUses === 'number' && Number.isFinite(body.maxUses)
      ? Math.min(10_000, Math.max(1, Math.floor(body.maxUses)))
      : 1;

  let expiresAt: string | null = null;
  if (typeof body.expiresAt === 'string' && body.expiresAt.trim()) {
    const parsed = new Date(body.expiresAt.trim());
    if (Number.isNaN(parsed.getTime())) throw badRequest('有效期格式不正确');
    expiresAt = parsed.toISOString();
  }

  let code: string | undefined;
  if (typeof body.code === 'string' && body.code.trim()) {
    code = body.code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,32}$/.test(code)) {
      throw badRequest('邀请码只能由字母、数字、连字符组成，长度 4-32');
    }
    if (await c.get('repos').invites.getByCode(code)) throw conflict('该邀请码已存在');
  }

  const invite = await c.get('repos').invites.create({
    code,
    maxUses,
    expiresAt,
    note: typeof body.note === 'string' ? body.note.slice(0, 200) : null,
    createdBy: c.get('user')!.id,
  });

  return json({ invite: toPublicInviteCode(invite) }, 201);
});

adminRoutes.patch('/invites/:id', async (c) => {
  const body = await readJson<{
    disabled?: unknown;
    maxUses?: unknown;
    expiresAt?: unknown;
    note?: unknown;
  }>(c.req.raw);

  const patch: {
    disabled?: boolean;
    maxUses?: number;
    expiresAt?: string | null;
    note?: string | null;
  } = {};

  if (typeof body.disabled === 'boolean') patch.disabled = body.disabled;
  if (typeof body.maxUses === 'number' && Number.isFinite(body.maxUses)) {
    patch.maxUses = Math.min(10_000, Math.max(1, Math.floor(body.maxUses)));
  }
  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null || body.expiresAt === '') {
      patch.expiresAt = null;
    } else if (typeof body.expiresAt === 'string') {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime())) throw badRequest('有效期格式不正确');
      patch.expiresAt = parsed.toISOString();
    }
  }
  if (typeof body.note === 'string') patch.note = body.note.slice(0, 200);

  const updated = await c.get('repos').invites.patch(c.req.param('id'), patch);
  if (!updated) throw notFound('邀请码不存在');
  return json({ invite: toPublicInviteCode(updated) });
});

adminRoutes.delete('/invites/:id', async (c) => {
  const existing = await c.get('repos').invites.getById(c.req.param('id'));
  if (!existing) throw notFound('邀请码不存在');
  await c.get('repos').invites.remove(existing.id);
  return json({ ok: true });
});
