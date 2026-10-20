import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { ApiEnv } from '../context';
import { hashPassword, verifyPassword } from '../lib/crypto';
import {
  badRequest,
  clientIp,
  conflict,
  forbidden,
  json,
  optionalString,
  readJson,
  requireEmail,
  requirePassword,
  requireString,
  tooManyRequests,
  unauthorized,
} from '../lib/http';
import { requireAuth } from '../middleware';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../repos/sessions';
import { normalizeEmail } from '../repos/users';
import { isInviteUsable } from '../repos/invites';
import { toPublicUser, type InviteCodeRecord, type UserRole } from '../repos/types';
import { buildResetPasswordEmail, buildVerifyEmail, sendEmail } from '../services/mail';
import { verifyTurnstile } from '../services/turnstile';

export const authRoutes = new Hono<ApiEnv>();

function isSecureRequest(c: Context<ApiEnv>): boolean {
  const url = new URL(c.req.url);
  if (url.protocol === 'https:') return true;
  return (c.req.header('x-forwarded-proto') ?? '').split(',')[0].trim() === 'https';
}

function setSessionCookie(c: Context<ApiEnv>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

async function createSessionAndRespond(
  c: Context<ApiEnv>,
  userId: string,
  extra: Record<string, unknown> = {},
  status = 200
) {
  const { token } = await c.get('repos').sessions.create({
    userId,
    userAgent: c.req.header('user-agent') ?? null,
    ip: clientIp((name) => c.req.header(name)),
  });
  setSessionCookie(c, token);
  const user = await c.get('repos').users.getById(userId);
  return json({ user: user ? toPublicUser(user) : null, ...extra }, status);
}

async function requireTurnstile(c: Context<ApiEnv>, token: unknown) {
  const config = await c.get('settings').turnstileConfig();
  const result = await verifyTurnstile(
    config,
    typeof token === 'string' ? token : undefined,
    clientIp((name) => c.req.header(name))
  );
  if (!result.ok) throw tooManyRequests(result.reason ?? '人机验证未通过');
}

async function issueAndSendVerifyEmail(c: Context<ApiEnv>, userId: string, email: string) {
  const { token } = await c.get('repos').authTokens.issue(userId, 'verify_email');
  const [siteName, siteUrl, resend] = await Promise.all([
    c.get('settings').siteName(),
    c.get('settings').siteUrl(),
    c.get('settings').resendConfig(),
  ]);
  const content = buildVerifyEmail(siteName, siteUrl || new URL(c.req.url).origin, token);
  await sendEmail(resend, { to: email, ...content });
}

authRoutes.post('/register', async (c) => {
  const currentUser = c.get('user');
  const allowRegistration = await c.get('settings').allowRegistration();
  if (!allowRegistration && currentUser?.role !== 'admin') {
    throw forbidden('站点已关闭注册，请联系管理员开通账号');
  }

  const body = await readJson<{
    email?: unknown;
    password?: unknown;
    displayName?: unknown;
    turnstileToken?: unknown;
    inviteCode?: unknown;
  }>(c.req.raw);

  await requireTurnstile(c, body.turnstileToken);

  const email = requireEmail(body.email);
  const password = requirePassword(body.password);
  const displayName = optionalString(body.displayName, 60);

  // 邀请码：站点开启后必须提供有效邀请码；管理员代建账号不受此限制
  const needInvite =
    currentUser?.role !== 'admin' && (await c.get('settings').inviteRequired());
  let invite: InviteCodeRecord | null = null;
  if (needInvite) {
    const code = optionalString(body.inviteCode, 64);
    if (!code) throw badRequest('本站需要邀请码才能注册');
    invite = await c.get('repos').invites.getByCode(code);
    if (!invite || !isInviteUsable(invite)) {
      throw badRequest('邀请码无效、已过期或已用完');
    }
  }

  const users = c.get('repos').users;
  if (await users.getByEmail(email)) throw conflict('该邮箱已注册');

  // 先原子占用名额再建号：并发注册时不会把次数用超
  if (invite) {
    const consumed = await c.get('repos').invites.consume(invite.id);
    if (!consumed) throw badRequest('邀请码已被用完');
  }

  let role: UserRole = 'user';
  let emailVerified = false;
  if (c.env.ADMIN_EMAIL && normalizeEmail(c.env.ADMIN_EMAIL) === email) {
    role = 'admin';
    emailVerified = true;
  } else if ((c.env.BOOTSTRAP_FIRST_ADMIN ?? 'true').trim().toLowerCase() !== 'false') {
    if ((await users.count()) === 0) {
      role = 'admin';
      emailVerified = true;
    }
  }

  const user = await users.create({
    email,
    displayName,
    role,
    emailVerified,
    password: await hashPassword(password),
  });

  // 勾选了「新用户自动加入」的团队空间，注册即入队，权限取该空间的默认值
  const autoJoinTeams = await c.get('repos').teams.listAutoJoin();
  for (const team of autoJoinTeams) {
    await c.get('repos').teams.addMember(team.id, user.id, {
      canCreate: !!team.default_can_create,
      canUpdate: !!team.default_can_update,
      canDelete: !!team.default_can_delete,
      isAdmin: !!team.default_is_admin,
    });
  }

  let emailSent = false;
  if (!emailVerified) {
    try {
      await issueAndSendVerifyEmail(c, user.id, user.email);
      emailSent = true;
    } catch (error) {
      console.error('[auth] 发送验证邮件失败:', error);
    }
  }

  return createSessionAndRespond(c, user.id, { emailSent }, 201);
});

authRoutes.post('/login', async (c) => {
  const body = await readJson<{ email?: unknown; password?: unknown; turnstileToken?: unknown }>(
    c.req.raw
  );
  await requireTurnstile(c, body.turnstileToken);

  const email = normalizeEmail(requireString(body.email, 'email', { max: 200 }));
  const password = requireString(body.password, 'password', { min: 1, max: 200, trim: false });

  const users = c.get('repos').users;
  const user = await users.getByEmail(email);

  // 账号不存在与密码错误返回同一文案，避免被用来枚举已注册邮箱
  if (!user) throw unauthorized('邮箱或密码不正确', 'INVALID_CREDENTIALS');
  if (user.disabled) throw forbidden('账号已被禁用，请联系管理员');
  if (!(await verifyPassword(password, {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iterations,
  }))) {
    throw unauthorized('邮箱或密码不正确', 'INVALID_CREDENTIALS');
  }

  await users.update(user.id, { lastLoginAt: new Date().toISOString() });
  return createSessionAndRespond(c, user.id);
});

authRoutes.post('/logout', async (c) => {
  const token = c.get('sessionToken');
  if (token) await c.get('repos').sessions.remove(token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const user = c.get('user');
  return json({
    user: user ? toPublicUser(user) : null,
    storage: c.get('runtime').platform,
    config: await c.get('settings').publicConfig(),
  });
});

authRoutes.post('/password', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(c.req.raw);
  const currentPassword = requireString(body.currentPassword, 'currentPassword', {
    min: 1,
    max: 200,
    trim: false,
  });
  const newPassword = requirePassword(body.newPassword, 'newPassword');

  const ok = await verifyPassword(currentPassword, {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iterations,
  });
  if (!ok) throw unauthorized('当前密码不正确', 'INVALID_CREDENTIALS');

  await c.get('repos').users.update(user.id, { password: await hashPassword(newPassword) });
  await c.get('repos').sessions.removeByUser(user.id);
  return createSessionAndRespond(c, user.id);
});

authRoutes.post('/verify-email/resend', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (user.email_verified) return json({ ok: true, alreadyVerified: true });
  await issueAndSendVerifyEmail(c, user.id, user.email);
  return json({ ok: true });
});

authRoutes.post('/verify-email', async (c) => {
  const body = await readJson<{ token?: unknown }>(c.req.raw);
  const token = requireString(body.token, 'token');
  const userId = await c.get('repos').authTokens.consume(token, 'verify_email');
  if (!userId) throw badRequest('验证链接无效或已过期', 'TOKEN_INVALID');
  await c.get('repos').users.update(userId, { emailVerified: true });
  return json({ ok: true });
});

/** 始终返回同一条成功文案，避免被用来枚举已注册邮箱 */
authRoutes.post('/forgot-password', async (c) => {
  const body = await readJson<{ email?: unknown; turnstileToken?: unknown }>(c.req.raw);
  await requireTurnstile(c, body.turnstileToken);
  const email = normalizeEmail(requireString(body.email, 'email', { max: 200 }));

  const user = await c.get('repos').users.getByEmail(email);
  if (user && !user.disabled) {
    try {
      const { token } = await c.get('repos').authTokens.issue(user.id, 'reset_password');
      const [siteName, siteUrl, resend] = await Promise.all([
        c.get('settings').siteName(),
        c.get('settings').siteUrl(),
        c.get('settings').resendConfig(),
      ]);
      const content = buildResetPasswordEmail(siteName, siteUrl || new URL(c.req.url).origin, token);
      await sendEmail(resend, { to: user.email, ...content });
    } catch (error) {
      console.error('[auth] 发送找回密码邮件失败:', error);
    }
  }

  return json({ ok: true, message: '如果该邮箱已注册，我们已发送找回密码邮件' });
});

authRoutes.post('/reset-password', async (c) => {
  const body = await readJson<{ token?: unknown; newPassword?: unknown }>(c.req.raw);
  const token = requireString(body.token, 'token');
  const newPassword = requirePassword(body.newPassword, 'newPassword');

  const userId = await c.get('repos').authTokens.consume(token, 'reset_password');
  if (!userId) throw badRequest('找回密码链接无效或已过期', 'TOKEN_INVALID');

  await c.get('repos').users.update(userId, { password: await hashPassword(newPassword) });
  await c.get('repos').sessions.removeByUser(userId);
  return createSessionAndRespond(c, userId);
});
