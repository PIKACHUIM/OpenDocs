import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ApiEnv } from '../context';
import { hashPassword, randomId, type PasswordHash } from '../lib/crypto';
import { getText } from '../files';
import {
  badRequest,
  conflict,
  forbidden,
  json,
  notFound,
  readJson,
  requireEmail,
  requireString,
} from '../lib/http';
import { requireAdmin } from '../middleware';
import { toPublicInviteCode, toPublicTeam, toPublicTeamMember } from '../repos/types';
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
  const superAdminId = await c.get('repos').users.getSuperAdminId();

  return json({
    users: users.map((user, index) => ({
      ...toPublicUser(user),
      documentCount: counts[index],
      // 前端据此禁用「超级管理员」的降级/删除按钮
      isSuperAdmin: user.id === superAdminId,
    })),
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

    const superAdminId = await c.get('repos').users.getSuperAdminId();
    const changingRole = body.role !== target.role;

    if (changingRole) {
      // 先判「自己」：不论是谁，都返回同一句明确提示
      if (target.id === actor.id) throw conflict('不能修改自己的管理员身份');
      // 授予 / 取消管理员是超级管理员的专属操作
      if (actor.id !== superAdminId) {
        throw forbidden('只有超级管理员可以设置或取消管理员');
      }
      // 超级管理员本身不可被降级
      if (target.id === superAdminId) throw conflict('超级管理员不能被取消管理员权限');
      if (body.role === 'user' && (await countActiveAdmins(c)) <= 1) {
        throw conflict('至少需要保留一个管理员');
      }
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
  // 任何管理员都不能删除自己
  if (target.id === actor.id) throw conflict('不能删除当前登录的账号');
  if (target.role === 'admin') {
    const superAdminId = await c.get('repos').users.getSuperAdminId();
    if (target.id === superAdminId) throw conflict('超级管理员不能被删除');
    if ((await countActiveAdmins(c)) <= 1) throw conflict('至少需要保留一个管理员');
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
    defaultPermissions?: unknown;
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

  // 新用户/新分享的默认权限
  if (body.defaultPermissions && typeof body.defaultPermissions === 'object') {
    const perms = body.defaultPermissions as Record<string, unknown>;
    const map: Array<[string, string]> = [
      ['canCreate', SETTINGS_KEYS.defaultCanCreate],
      ['canRead', SETTINGS_KEYS.defaultCanRead],
      ['canUpdate', SETTINGS_KEYS.defaultCanUpdate],
      ['canDelete', SETTINGS_KEYS.defaultCanDelete],
    ];
    for (const [field, key] of map) {
      if (typeof perms[field] === 'boolean') entries[key] = perms[field] ? 'true' : 'false';
    }
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

// ---------------------------------------------------------------------------
// 附件管理
// ---------------------------------------------------------------------------

adminRoutes.get('/assets', async (c) => {
  const { page, pageSize, offset } = paging(c.req.query('page'), c.req.query('pageSize'));
  const [rows, total, unreferenced] = await Promise.all([
    c.get('repos').assets.listAll(pageSize, offset),
    c.get('repos').assets.countAll(),
    c.get('repos').assets.listUnreferenced(),
  ]);

  return json({
    assets: rows.map((asset) => ({
      id: asset.id,
      url: `/api/assets/${asset.id}`,
      contentType: asset.content_type,
      sizeBytes: asset.size_bytes,
      documentId: asset.document_id,
      ownerEmail: asset.owner_email,
      createdAt: asset.created_at,
    })),
    total,
    unreferenced: unreferenced.length,
    page,
    pageSize,
  });
});

adminRoutes.delete('/assets/:id', async (c) => {
  const asset = await c.get('repos').assets.getById(c.req.param('id'));
  if (!asset) return json({ ok: true });
  await c.get('runtime').files.delete(asset.file_key);
  await c.get('repos').assets.remove(asset.id);
  return json({ ok: true });
});

/** 清理「绑定文档已被彻底删除」的附件 */
adminRoutes.post('/assets/cleanup', async (c) => {
  const rows = await c.get('repos').assets.listUnreferenced();
  for (const asset of rows) {
    await c.get('runtime').files.delete(asset.file_key);
    await c.get('repos').assets.remove(asset.id);
  }
  return json({ ok: true, removed: rows.length });
});

// ---------------------------------------------------------------------------
// 团队空间
// ---------------------------------------------------------------------------

/** 解析团队设置里的布尔/数字字段，避免把字符串写进 INTEGER 列 */
function teamPatchFrom(body: Record<string, unknown>) {
  const bool = (value: unknown) => (typeof value === 'boolean' ? value : undefined);
  const num = (value: unknown) => {
    if (value === undefined) return undefined;
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  return {
    name: typeof body.name === 'string' ? body.name.trim().slice(0, 60) : undefined,
    quotaBytes: num(body.quotaBytes),
    allowImage: bool(body.allowImage),
    allowFile: bool(body.allowFile),
    maxImageBytes: num(body.maxImageBytes),
    maxFileBytes: num(body.maxFileBytes),
    readonly: bool(body.readonly),
    defaultCanCreate: bool(body.defaultCanCreate),
    defaultCanUpdate: bool(body.defaultCanUpdate),
    defaultCanDelete: bool(body.defaultCanDelete),
    defaultIsAdmin: bool(body.defaultIsAdmin),
    autoJoin: bool(body.autoJoin),
  };
}

adminRoutes.get('/teams', async (c) => {
  const teams = await c.get('repos').teams.listAll();
  const items = await Promise.all(
    teams.map(async (team) => ({
      ...toPublicTeam(team),
      ...(await c.get('repos').teams.stats(team.id)),
    }))
  );
  return json({ teams: items });
});

adminRoutes.post('/teams', async (c) => {
  const body = await readJson<Record<string, unknown>>(c.req.raw);
  const name = requireString(body.name, 'name', { min: 1, max: 60 });
  const team = await c.get('repos').teams.create({
    ...teamPatchFrom(body),
    name,
    createdBy: c.get('user')!.id,
  });
  return json({ team: { ...toPublicTeam(team), ...(await c.get('repos').teams.stats(team.id)) } }, 201);
});

adminRoutes.patch('/teams/:id', async (c) => {
  const team = await c.get('repos').teams.getById(c.req.param('id'));
  if (!team) throw notFound('团队空间不存在');
  const body = await readJson<Record<string, unknown>>(c.req.raw);
  const updated = await c.get('repos').teams.update(team.id, teamPatchFrom(body));
  return json({ team: { ...toPublicTeam(updated!), ...(await c.get('repos').teams.stats(team.id)) } });
});

adminRoutes.delete('/teams/:id', async (c) => {
  const team = await c.get('repos').teams.getById(c.req.param('id'));
  if (!team) return json({ ok: true });
  // 空间内文档不删除，转为个人文档，避免误删数据
  await c.get('repos').documents.detachTeam(team.id);
  await c.get('repos').teams.remove(team.id);
  return json({ ok: true });
});

/** 生成/重置邀请令牌（同一个空间同时只有一个） */
adminRoutes.post('/teams/:id/invite', async (c) => {
  const team = await c.get('repos').teams.getById(c.req.param('id'));
  if (!team) throw notFound('团队空间不存在');
  const token = randomId('ti', 12);
  await c.get('repos').teams.setInviteToken(team.id, token);
  return json({ ok: true, inviteToken: token });
});

adminRoutes.delete('/teams/:id/invite', async (c) => {
  const team = await c.get('repos').teams.getById(c.req.param('id'));
  if (!team) throw notFound('团队空间不存在');
  await c.get('repos').teams.setInviteToken(team.id, null);
  return json({ ok: true });
});

adminRoutes.get('/teams/:id/members', async (c) => {
  const team = await c.get('repos').teams.getById(c.req.param('id'));
  if (!team) throw notFound('团队空间不存在');
  const rows = await c.get('repos').teams.listMembers(team.id);
  return json({
    members: rows.map((row) =>
      toPublicTeamMember(row, { email: row.email, display_name: row.display_name })
    ),
  });
});

/** 按邮箱添加成员；已是成员则更新权限 */
adminRoutes.post('/teams/:id/members', async (c) => {
  const team = await c.get('repos').teams.getById(c.req.param('id'));
  if (!team) throw notFound('团队空间不存在');
  const body = await readJson<{ email?: unknown; userId?: unknown }>(c.req.raw);

  const user =
    typeof body.userId === 'string'
      ? await c.get('repos').users.getById(body.userId)
      : typeof body.email === 'string'
        ? await c.get('repos').users.getByEmail(requireEmail(body.email))
        : null;
  if (!user) throw notFound('用户不存在');

  await c.get('repos').teams.addMember(team.id, user.id, {
    canCreate: !!team.default_can_create,
    canUpdate: !!team.default_can_update,
    canDelete: !!team.default_can_delete,
    isAdmin: !!team.default_is_admin,
  });
  return json({ ok: true });
});

adminRoutes.patch('/teams/:id/members/:userId', async (c) => {
  const team = await c.get('repos').teams.getById(c.req.param('id'));
  if (!team) throw notFound('团队空间不存在');
  const member = await c.get('repos').teams.getMember(team.id, c.req.param('userId'));
  if (!member) throw notFound('该用户不在团队内');

  const body = await readJson<Record<string, unknown>>(c.req.raw);
  const pick = (value: unknown, fallback: number) =>
    typeof value === 'boolean' ? (value ? 1 : 0) : fallback;

  await c.get('repos').teams.addMember(team.id, member.user_id, {
    canCreate: !!pick(body.canCreate, member.can_create),
    canUpdate: !!pick(body.canUpdate, member.can_update),
    canDelete: !!pick(body.canDelete, member.can_delete),
    isAdmin: !!pick(body.isAdmin, member.is_admin),
  });
  return json({ ok: true });
});

adminRoutes.delete('/teams/:id/members/:userId', async (c) => {
  const team = await c.get('repos').teams.getById(c.req.param('id'));
  if (!team) throw notFound('团队空间不存在');
  await c.get('repos').teams.removeMember(team.id, c.req.param('userId'));
  return json({ ok: true });
});

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
