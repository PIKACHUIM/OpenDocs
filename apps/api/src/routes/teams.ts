import { Hono } from 'hono';
import type { ApiEnv } from '../context';
import { badRequest, json, notFound, readJson } from '../lib/http';
import { requireAuth } from '../middleware';
import { toPublicTeam, type TeamRecord } from '../repos/types';

export const teamRoutes = new Hono<ApiEnv>();
teamRoutes.use('*', requireAuth);

/** 我加入的团队空间（含我在其中的权限） */
teamRoutes.get('/', async (c) => {
  const user = c.get('user')!;
  const rows = await c.get('repos').teams.listByUser(user.id);

  return json({
    teams: rows.map((row) => {
      const readonly = !!row.readonly;
      const isAdmin = !!row.is_admin;
      return {
        ...toPublicTeam(row as TeamRecord),
        permissions: {
          isAdmin,
          // 只读模式下，普通成员的写权限全部失效
          canCreate: isAdmin || (!!row.can_create && !readonly),
          canUpdate: isAdmin || (!!row.can_update && !readonly),
          canDelete: isAdmin || (!!row.can_delete && !readonly),
        },
      };
    }),
  });
});

/** 用邀请链接加入团队；令牌即口令，同一空间只会有一个 */
teamRoutes.post('/join', async (c) => {
  const body = await readJson<{ token?: unknown }>(c.req.raw);
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) throw badRequest('缺少邀请令牌');

  const team = await c.get('repos').teams.findByInviteToken(token);
  if (!team) throw notFound('邀请链接无效或已被重置');

  const user = c.get('user')!;
  const existing = await c.get('repos').teams.getMember(team.id, user.id);
  if (existing) return json({ ok: true, teamId: team.id, already: true });

  await c.get('repos').teams.addMember(team.id, user.id, {
    canCreate: !!team.default_can_create,
    canUpdate: !!team.default_can_update,
    canDelete: !!team.default_can_delete,
    isAdmin: !!team.default_is_admin,
  });

  return json({ ok: true, teamId: team.id, already: false });
});
