import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ApiEnv } from '../context';
import { randomId } from '../lib/crypto';
import { badRequest, clientIp, forbidden, json, notFound, readJson } from '../lib/http';
import { RATE_LIMITS, enforceRateLimit } from '../lib/rate-limit';
import { requireAuth } from '../middleware';
import { toPublicTeam, toPublicTeamMember, type TeamRecord } from '../repos/types';

/**
 * 团队管理员（或系统管理员）才能管理成员与邀请链接。
 * 团队管理员由系统管理员在后台设置（is_admin）。
 */
async function requireTeamAdmin(c: Context<ApiEnv>, teamId: string) {
  const team = await c.get('repos').teams.getById(teamId);
  if (!team) throw notFound('团队空间不存在');
  const user = c.get('user')!;
  if (user.role === 'admin') return team;

  const member = await c.get('repos').teams.getMember(teamId, user.id);
  if (!member?.is_admin) throw forbidden('只有团队管理员可以管理该空间');
  return team;
}

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
  enforceRateLimit(
    `team-join:ip:${clientIp((name) => c.req.header(name)) ?? 'unknown'}`,
    RATE_LIMITS.teamJoin
  );
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

// ---------------------------------------------------------------------------
// 团队管理员：成员管理与邀请链接
// ---------------------------------------------------------------------------

teamsMembersRoutes();

function teamsMembersRoutes() {
  teamRoutes.get('/:id/members', async (c) => {
    const team = await requireTeamAdmin(c, c.req.param('id'));
    const rows = await c.get('repos').teams.listMembers(team.id);
    return json({
      members: rows.map((row) =>
        toPublicTeamMember(row, { email: row.email, display_name: row.display_name })
      ),
    });
  });

  teamRoutes.post('/:id/members', async (c) => {
    const team = await requireTeamAdmin(c, c.req.param('id'));
    const body = await readJson<{ email?: unknown; userId?: unknown }>(c.req.raw);

    const user =
      typeof body.userId === 'string'
        ? await c.get('repos').users.getById(body.userId)
        : typeof body.email === 'string'
          ? await c.get('repos').users.getByEmail(body.email.trim().toLowerCase())
          : null;
    if (!user) throw notFound('用户不存在');
    if (!user.email_verified) {
      throw badRequest('该邮箱尚未完成验证，请对方先验证邮箱后再添加', 'TARGET_UNVERIFIED');
    }

    await c.get('repos').teams.addMember(team.id, user.id, {
      canCreate: !!team.default_can_create,
      canUpdate: !!team.default_can_update,
      canDelete: !!team.default_can_delete,
      isAdmin: !!team.default_is_admin,
    });
    return json({ ok: true });
  });

  teamRoutes.patch('/:id/members/:userId', async (c) => {
    const team = await requireTeamAdmin(c, c.req.param('id'));
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

  teamRoutes.delete('/:id/members/:userId', async (c) => {
    const team = await requireTeamAdmin(c, c.req.param('id'));
    await c.get('repos').teams.removeMember(team.id, c.req.param('userId'));
    return json({ ok: true });
  });

  teamRoutes.post('/:id/invite', async (c) => {
    const team = await requireTeamAdmin(c, c.req.param('id'));
    const token = randomId('ti', 12);
    await c.get('repos').teams.setInviteToken(team.id, token);
    return json({ ok: true, inviteToken: token });
  });

  teamRoutes.delete('/:id/invite', async (c) => {
    const team = await requireTeamAdmin(c, c.req.param('id'));
    await c.get('repos').teams.setInviteToken(team.id, null);
    return json({ ok: true });
  });
}
