import type { ApiBindings } from '../context';
import type { SettingsRepo } from '../repos/settings';

/** 设置键：管理后台可写，写了之后优先于环境变量；没写就按环境变量兜底 */
export const SETTINGS_KEYS = {
  siteName: 'site_name',
  siteUrl: 'site_url',
  allowRegistration: 'allow_registration',
  resendApiKey: 'resend_api_key',
  resendFrom: 'resend_from',
  turnstileEnabled: 'turnstile_enabled',
  turnstileSiteKey: 'turnstile_site_key',
  turnstileSecretKey: 'turnstile_secret_key',
} as const;

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off']);

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (TRUE.has(normalized)) return true;
  if (FALSE.has(normalized)) return false;
  return fallback;
}

export interface ResendConfig {
  apiKey: string | null;
  from: string | null;
}

export interface TurnstileConfig {
  enabled: boolean;
  siteKey: string | null;
  secretKey: string | null;
}

/**
 * 系统设置服务：数据库（管理后台可改）优先，环境变量/Secret 兜底。
 * 每个请求重新读一次数据库设置（避免多实例间缓存不一致），D1 读很快，不构成瓶颈。
 */
export function createSettingsService(repo: SettingsRepo, env: ApiBindings) {
  const load = async (): Promise<Record<string, string>> => repo.getAll();

  const siteName = async (db?: Record<string, string>) =>
    (db ?? (await load()))[SETTINGS_KEYS.siteName] || env.SITE_NAME || 'Drawnix';

  const siteUrl = async (db?: Record<string, string>) =>
    (db ?? (await load()))[SETTINGS_KEYS.siteUrl] || env.SITE_URL || '';

  const allowRegistration = async (db?: Record<string, string>) => {
    const stored = (db ?? (await load()))[SETTINGS_KEYS.allowRegistration];
    return parseBool(stored, parseBool(env.ALLOW_REGISTRATION, true));
  };

  const resendConfig = async (db?: Record<string, string>): Promise<ResendConfig> => {
    const settings = db ?? (await load());
    return {
      apiKey: settings[SETTINGS_KEYS.resendApiKey] || env.RESEND_API_KEY || null,
      from: settings[SETTINGS_KEYS.resendFrom] || env.RESEND_FROM || null,
    };
  };

  const turnstileConfig = async (db?: Record<string, string>): Promise<TurnstileConfig> => {
    const settings = db ?? (await load());
    const enabled =
      parseBool(env.TURNSTILE_DISABLED, false) === true
        ? false
        : parseBool(settings[SETTINGS_KEYS.turnstileEnabled], !!env.TURNSTILE_SECRET_KEY);
    return {
      enabled,
      siteKey: settings[SETTINGS_KEYS.turnstileSiteKey] || env.TURNSTILE_SITE_KEY || null,
      secretKey: settings[SETTINGS_KEYS.turnstileSecretKey] || env.TURNSTILE_SECRET_KEY || null,
    };
  };

  /** 前端注册/登录页需要的公开配置（不含任何密钥） */
  const publicConfig = async () => {
    const db = await load();
    const turnstile = await turnstileConfig(db);
    return {
      siteName: await siteName(db),
      allowRegistration: await allowRegistration(db),
      turnstileEnabled: turnstile.enabled && !!turnstile.siteKey,
      turnstileSiteKey: turnstile.enabled ? turnstile.siteKey : null,
    };
  };

  /** 管理后台配置视图：密钥只回显掩码，避免明文在前端暴露 */
  const adminConfig = async () => {
    const db = await load();
    const resend = await resendConfig(db);
    const turnstile = await turnstileConfig(db);
    return {
      siteName: await siteName(db),
      siteUrl: await siteUrl(db),
      allowRegistration: await allowRegistration(db),
      resendApiKeySet: !!resend.apiKey,
      resendApiKeyMasked: maskSecret(resend.apiKey),
      resendFrom: resend.from,
      turnstileEnabled: turnstile.enabled,
      turnstileSiteKey: turnstile.siteKey,
      turnstileSecretKeySet: !!turnstile.secretKey,
      turnstileSecretKeyMasked: maskSecret(turnstile.secretKey),
    };
  };

  return {
    load,
    siteName,
    siteUrl,
    allowRegistration,
    resendConfig,
    turnstileConfig,
    publicConfig,
    adminConfig,
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;

function maskSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 6) return '••••';
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}
