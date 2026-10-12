import type { TurnstileConfig } from './settings';

interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Cloudflare Turnstile 服务端校验。未启用或未配置密钥时直接放行——
 * 避免管理员忘记关闭开关导致所有人被锁在注册/登录页外。
 */
export async function verifyTurnstile(
  config: TurnstileConfig,
  token: string | undefined,
  remoteIp: string | null
): Promise<{ ok: boolean; reason?: string }> {
  if (!config.enabled || !config.secretKey) return { ok: true };
  if (!token) return { ok: false, reason: '请完成人机验证' };

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: config.secretKey,
      response: token,
      remoteip: remoteIp ?? undefined,
    }),
  });

  if (!response.ok) return { ok: false, reason: '人机验证服务暂时不可用' };
  const data = (await response.json()) as TurnstileVerifyResponse;
  if (!data.success) {
    return { ok: false, reason: `人机验证未通过（${data['error-codes']?.join(',') ?? 'unknown'}）` };
  }
  return { ok: true };
}
