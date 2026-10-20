import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { ApiEnv } from '../context';
import { DEFAULT_ITERATIONS, DUMMY_PASSWORD_HASH, hashPassword, needsRehash, verifyPassword } from '../lib/crypto';
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
import { RATE_LIMITS, enforceRateLimit } from '../lib/rate-limit';
import { requireAuth } from '../middleware';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../repos/sessions';
import { normalizeEmail } from '../repos/users';
import { isInviteUsable } from '../repos/invites';
import { toPublicUser, type InviteCodeRecord, type UserRole } from '../repos/types';
import { buildResetPasswordEmail, buildVerifyEmail, sendEmail } from '../services/mail';
import { verifyTurnstile } from '../services/turnstile';

export const authRoutes = new Hono<ApiEnv>();

/**
 * 是否给 Cookie 打 Secure。
 *
 * 只认请求 URL 的协议，**不再信任 `X-Forwarded-Proto`**：那是客户端可伪造的头，
 * 用它决定安全属性等于把降级开关交给攻击者。Workers / EdgeOne 上 request.url
 * 本来就是 https，本地 http 调试则正确地不加 Secure。
 */
function isSecureRequest(c: Context<ApiEnv>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

/**
 * 邮件里绝对链接的站点地址。
 *
 * 优先用设置/环境变量里的 `SITE_URL`；未配置时回退到请求域名，但可以用
 * `ALLOWED_HOSTS`（逗号分隔）把回退限制在可信域名内——否则 Host 头一旦可被改写，
 * 找回密码链接就会把令牌送到攻击者域名。
 */
async function resolveSiteOrigin(c: Context<ApiEnv>): Promise<string | null> {
  const configured = (await c.get('settings').siteUrl()).trim();
  if (configured) return configured.replace(/\/+$/, '');

  const origin = new URL(c.req.url);
  const allowList = (c.env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (allowList.length > 0 && !allowList.includes(origin.host.toLowerCase())) {
    console.error('[auth] 未配置 SITE_URL，且请求域名不在 ALLOWED_HOSTS 内，已拒绝生成邮件链接');
    return null;
  }
  console.warn('[auth] 未配置 SITE_URL，邮件链接回退到请求域名，建议显式配置以免受 Host 头影响');
  return origin.origin;
}

/** 邮件发送走 waitUntil，避免 SMTP/HTTP 抖动把注册、找回密码的响应拖住 */
function sendEmailInBackground(c: Context<ApiEnv>, task: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    void task;
  }
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

/** 发送验证邮件；返回是否真的投递（未配置 Resend 时为 false，不再假装成功） */
async function issueAndSendVerifyEmail(
  c: Context<ApiEnv>,
  userId: string,
  email: string
): Promise<boolean> {
  const { token } = await c.get('repos').authTokens.issue(userId, 'verify_email');
  const [siteName, resend, origin] = await Promise.all([
    c.get('settings').siteName(),
    c.get('settings').resendConfig(),
    resolveSiteOrigin(c),
  ]);
  if (!origin) return false;
  return sendEmail(resend, { to: email, ...buildVerifyEmail(siteName, origin, token) });
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
  enforceRateLimit(`register:ip:${clientIp((name) => c.req.header(name)) ?? 'unknown'}`, RATE_LIMITS.registerIp);

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

  // 没有配置发信服务时根本无法完成邮箱验证；此时若仍把账号标记为未验证，
  // 会导致这个实例上「谁都不能被分享」，等于把功能锁死。这种情况直接视为已验证，
  // 并在日志里提示管理员；一旦配置了 Resend，就恢复「注册 → 验证 → 可被分享」链路。
  const resend = await c.get('settings').resendConfig();
  const mailEnabled = !!(resend.apiKey && resend.from);
  if (!emailVerified && !mailEnabled) {
    emailVerified = true;
    console.warn('[auth] 未配置 Resend，新账号跳过邮箱验证（配置发信后自动恢复）');
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
  if (!emailVerified && mailEnabled) {
    try {
      emailSent = await issueAndSendVerifyEmail(c, user.id, user.email);
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

  const ip = clientIp((name) => c.req.header(name)) ?? 'unknown';
  enforceRateLimit(`login:ip:${ip}`, RATE_LIMITS.loginIp);

  const email = normalizeEmail(requireString(body.email, 'email', { max: 200 }));
  const password = requireString(body.password, 'password', { min: 1, max: 200, trim: false });
  // 按账号再限一层：换 IP 也不能无限猜同一个账号的密码
  enforceRateLimit(`login:acct:${email}`, RATE_LIMITS.loginAccount);

  const users = c.get('repos').users;
  const user = await users.getByEmail(email);

  // 账号不存在与密码错误返回同一文案，避免被用来枚举已注册邮箱
  if (!user) {
    // 等时处理：对不存在的账号也跑一次同成本的 PBKDF2，否则响应耗时（实测差 50ms）
    // 会稳定泄露「该邮箱是否已注册」
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    throw unauthorized('邮箱或密码不正确', 'INVALID_CREDENTIALS');
  }
  if (user.disabled) throw forbidden('账号已被禁用，请联系管理员');
  const stored = {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iterations,
  };
  if (!(await verifyPassword(password, stored))) {
    throw unauthorized('邮箱或密码不正确', 'INVALID_CREDENTIALS');
  }

  // 迭代数落后于当前默认值时，登录成功后顺带升级哈希（用户无感）
  const patch: { lastLoginAt: string; password?: Awaited<ReturnType<typeof hashPassword>> } = {
    lastLoginAt: new Date().toISOString(),
  };
  if (needsRehash(stored)) {
    patch.password = await hashPassword(password, DEFAULT_ITERATIONS);
  }
  await users.update(user.id, patch);
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
  const superAdminId = user ? await c.get('repos').users.getSuperAdminId() : null;
  return json({
    user: user ? toPublicUser(user) : null,
    // 前端据此决定是否显示「设为管理员 / 取消管理员」
    isSuperAdmin: !!user && user.id === superAdminId,
    // 存储驱动属于部署内部信息，只给已登录用户看
    storage: user ? c.get('runtime').platform : '',
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
  enforceRateLimit(`verify-resend:${user.id}`, RATE_LIMITS.forgotAccount);
  const sent = await issueAndSendVerifyEmail(c, user.id, user.email);
  return json({ ok: true, sent });
});

authRoutes.post('/verify-email', async (c) => {
  enforceRateLimit(
    `verify-email:ip:${clientIp((name) => c.req.header(name)) ?? 'unknown'}`,
    RATE_LIMITS.authTokenIp
  );
  const body = await readJson<{ token?: unknown }>(c.req.raw);
  const token = requireString(body.token, 'token');
  const userId = await c.get('repos').authTokens.consume(token, 'verify_email');
  if (!userId) throw badRequest('验证链接无效或已过期', 'TOKEN_INVALID');
  await c.get('repos').users.update(userId, { emailVerified: true });
  return json({ ok: true });
});

/** 始终返回同一条成功文案，避免被用来枚举已注册邮箱 */
authRoutes.post('/forgot-password', async (c) => {
  enforceRateLimit(
    `forgot:ip:${clientIp((name) => c.req.header(name)) ?? 'unknown'}`,
    RATE_LIMITS.forgotIp
  );
  const body = await readJson<{ email?: unknown; turnstileToken?: unknown }>(c.req.raw);
  await requireTurnstile(c, body.turnstileToken);
  const email = normalizeEmail(requireString(body.email, 'email', { max: 200 }));
  // 同一邮箱也限流：避免被用作「邮件轰炸别人的收件箱」
  enforceRateLimit(`forgot:acct:${email}`, RATE_LIMITS.forgotAccount);

  const user = await c.get('repos').users.getByEmail(email);
  if (user && !user.disabled) {
    const task = (async () => {
      const { token } = await c.get('repos').authTokens.issue(user.id, 'reset_password');
      const [siteName, resend, origin] = await Promise.all([
        c.get('settings').siteName(),
        c.get('settings').resendConfig(),
        resolveSiteOrigin(c),
      ]);
      if (!origin) return;
      await sendEmail(resend, { to: user.email, ...buildResetPasswordEmail(siteName, origin, token) });
    })();
    // 发信放到后台，响应耗时与「邮箱是否已注册」解耦（同样是为了消除枚举侧信道）
    sendEmailInBackground(c, task.catch((error) => console.error('[auth] 发送找回密码邮件失败:', error)));
  }

  return json({ ok: true, message: '如果该邮箱已注册，我们已发送找回密码邮件' });
});

authRoutes.post('/reset-password', async (c) => {
  enforceRateLimit(
    `reset-password:ip:${clientIp((name) => c.req.header(name)) ?? 'unknown'}`,
    RATE_LIMITS.authTokenIp
  );
  const body = await readJson<{ token?: unknown; newPassword?: unknown }>(c.req.raw);
  const token = requireString(body.token, 'token');
  const newPassword = requirePassword(body.newPassword, 'newPassword');

  const userId = await c.get('repos').authTokens.consume(token, 'reset_password');
  if (!userId) throw badRequest('找回密码链接无效或已过期', 'TOKEN_INVALID');

  await c.get('repos').users.update(userId, { password: await hashPassword(newPassword) });
  await c.get('repos').sessions.removeByUser(userId);
  return createSessionAndRespond(c, userId);
});
