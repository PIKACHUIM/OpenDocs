import type { ApiBindings } from '../context';
import type { SettingsRepo } from '../repos/settings';

/** 设置键：管理后台可写，写了之后优先于环境变量；没写就按环境变量兜底 */
export const SETTINGS_KEYS = {
  siteName: 'site_name',
  siteUrl: 'site_url',
  allowRegistration: 'allow_registration',
  inviteRequired: 'invite_required',
  trashRetentionDays: 'trash_retention_days',
  uploadAllowImage: 'upload_allow_image',
  uploadAllowFile: 'upload_allow_file',
  uploadMaxImageBytes: 'upload_max_image_bytes',
  uploadMaxFileBytes: 'upload_max_file_bytes',
  quotaUserBytes: 'quota_user_bytes',
  quotaSystemBytes: 'quota_system_bytes',
  // 新用户/新分享的默认权限（创建/读取/修改/删除）
  defaultCanCreate: 'default_can_create',
  defaultCanRead: 'default_can_read',
  defaultCanUpdate: 'default_can_update',
  defaultCanDelete: 'default_can_delete',
  resendApiKey: 'resend_api_key',
  resendFrom: 'resend_from',
  turnstileEnabled: 'turnstile_enabled',
  turnstileSiteKey: 'turnstile_site_key',
  turnstileSecretKey: 'turnstile_secret_key',
} as const;

const DEFAULT_TRASH_RETENTION_DAYS = 30;
const MAX_TRASH_RETENTION_DAYS = 365;

/** 上传与容量默认值：8MB 图片、32MB 附件、1GB/人、20GB 全站 */
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024;
const DEFAULT_USER_QUOTA_BYTES = 1024 * 1024 * 1024;
const DEFAULT_SYSTEM_QUOTA_BYTES = 20 * 1024 * 1024 * 1024;

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
    (db ?? (await load()))[SETTINGS_KEYS.siteName] || env.SITE_NAME || 'OpenDocs';

  const siteUrl = async (db?: Record<string, string>) =>
    (db ?? (await load()))[SETTINGS_KEYS.siteUrl] || env.SITE_URL || '';

  const allowRegistration = async (db?: Record<string, string>) => {
    const stored = (db ?? (await load()))[SETTINGS_KEYS.allowRegistration];
    return parseBool(stored, parseBool(env.ALLOW_REGISTRATION, true));
  };

  /** 是否需要邀请码才能注册；默认关闭，只有显式开启才强制 */
  const inviteRequired = async (db?: Record<string, string>) => {
    const stored = (db ?? (await load()))[SETTINGS_KEYS.inviteRequired];
    return parseBool(stored, parseBool(env.INVITE_REQUIRED, false));
  };

  /**
   * 「最近删除」的保留天数：超过后由服务端惰性清理（打开最近删除时触发）。
   * 上限 365 天，避免把回收站当成长期存储。
   */
  const trashRetentionDays = async (db?: Record<string, string>) => {
    const raw =
      (db ?? (await load()))[SETTINGS_KEYS.trashRetentionDays] ?? env.TRASH_RETENTION_DAYS;
    const value = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_TRASH_RETENTION_DAYS;
    return Math.min(MAX_TRASH_RETENTION_DAYS, value);
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
      inviteRequired: await inviteRequired(db),
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
      inviteRequired: await inviteRequired(db),
      trashRetentionDays: await trashRetentionDays(db),
      ...(await uploadPolicy(db)),
      defaultPermissions: await defaultPermissions(db),
      resendApiKeySet: !!resend.apiKey,
      resendApiKeyMasked: maskSecret(resend.apiKey),
      resendFrom: resend.from,
      turnstileEnabled: turnstile.enabled,
      turnstileSiteKey: turnstile.siteKey,
      turnstileSecretKeySet: !!turnstile.secretKey,
      turnstileSecretKeyMasked: maskSecret(turnstile.secretKey),
    };
  };

  /**
   * 上传与容量策略（管理后台可配，未配置时用默认值）。
   */
  /**
   * 新用户/新分享的默认权限。
   * 分享时不显式指定权限，就以这里的值为准。
   * 删除默认关闭：文档删除只属于所有者。
   */
  const defaultPermissions = async (db?: Record<string, string>) => {
    const data = db ?? (await load());
    const readBool = (key: string, fallback: boolean) => {
      const value = data[key];
      if (value === undefined) return fallback;
      return value === 'true' || value === '1';
    };
    return {
      canCreate: readBool(SETTINGS_KEYS.defaultCanCreate, false),
      canRead: readBool(SETTINGS_KEYS.defaultCanRead, true),
      canUpdate: readBool(SETTINGS_KEYS.defaultCanUpdate, false),
      canDelete: readBool(SETTINGS_KEYS.defaultCanDelete, false),
    };
  };

  const uploadPolicy = async (db?: Record<string, string>) => {
    const data = db ?? (await load());
    const readNumber = (key: string, fallback: number) => {
      const value = Number.parseInt(String(data[key] ?? ''), 10);
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    return {
      allowImage: parseBool(data[SETTINGS_KEYS.uploadAllowImage], true),
      allowFile: parseBool(data[SETTINGS_KEYS.uploadAllowFile], true),
      maxImageBytes: readNumber(SETTINGS_KEYS.uploadMaxImageBytes, DEFAULT_MAX_IMAGE_BYTES),
      maxFileBytes: readNumber(SETTINGS_KEYS.uploadMaxFileBytes, DEFAULT_MAX_FILE_BYTES),
      userQuotaBytes: readNumber(SETTINGS_KEYS.quotaUserBytes, DEFAULT_USER_QUOTA_BYTES),
      systemQuotaBytes: readNumber(SETTINGS_KEYS.quotaSystemBytes, DEFAULT_SYSTEM_QUOTA_BYTES),
    };
  };

  return {
    load,
    siteName,
    siteUrl,
    allowRegistration,
    inviteRequired,
    trashRetentionDays,
    uploadPolicy,
    defaultPermissions,
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
