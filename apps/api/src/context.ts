import type { D1DatabaseLike, SqlClient } from './db/sql';
import type { FileStore, R2BucketLike } from './files';
import type { Repositories } from './repos';
import type { SettingsService } from './services/settings';
import type { UserRecord } from './repos/types';

/** 运行时可用的绑定与环境变量（各平台按需注入，全部可选） */
export interface ApiBindings {
  /** Cloudflare D1 绑定 */
  DB?: D1DatabaseLike;
  /** Cloudflare R2 绑定 */
  BUCKET?: R2BucketLike;

  /** 非 Cloudflare 运行时通过 D1 HTTP API 访问同一个库 */
  D1_ACCOUNT_ID?: string;
  D1_DATABASE_ID?: string;
  D1_API_TOKEN?: string;

  /** 文件驱动：r2 | edgeone-blob；不填时自动探测 */
  FILE_DRIVER?: string;
  EDGEONE_BLOB_STORE?: string;

  /** 本地开发 / 测试注入的实现（Workers 上不会出现） */
  SQL?: SqlClient;
  FILES?: FileStore;

  /** 首次启动时引导创建管理员 */
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
  /** 默认 true：库里还没有任何用户时，第一个注册者成为管理员 */
  BOOTSTRAP_FIRST_ADMIN?: string;

  /** 以下为系统设置的环境变量兜底，管理后台里的配置优先 */
  SITE_NAME?: string;
  SITE_URL?: string;
  ALLOW_REGISTRATION?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** 紧急开关：验证码配错把所有人锁在门外时，用它强制关闭验证码 */
  TURNSTILE_DISABLED?: string;

  /** 跨域调试时允许的来源，逗号分隔；同域部署留空 */
  CORS_ORIGIN?: string;
}

export interface Runtime {
  sql: SqlClient;
  files: FileStore;
  platform: string;
}

export interface ApiVariables {
  runtime: Runtime;
  repos: Repositories;
  settings: SettingsService;
  /** 当前登录用户，未登录为 null */
  user: UserRecord | null;
  /** 当前会话 token 明文（仅用于登出） */
  sessionToken: string | null;
}

export type ApiEnv = { Bindings: ApiBindings; Variables: ApiVariables };
