import { bytesToBase64Url, bytesToHex, utf8ToBytes } from './encoding';

/**
 * 只依赖 WebCrypto（Workers 与 Node 20 都内置），不引入 bcrypt/argon2 —— 后者在
 * Workers 与 EdgeOne 的函数运行时里都没有可靠的原生实现。
 */

type Bytes = Uint8Array<ArrayBuffer>;

export function randomBytes(length: number): Bytes {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** 生成 URL 安全的高熵随机串，用于会话 token、分享 token */
export function randomToken(byteLength = 32): string {
  return bytesToBase64Url(randomBytes(byteLength));
}

export function randomId(prefix: string, byteLength = 16): string {
  return `${prefix}_${bytesToBase64Url(randomBytes(byteLength))}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8ToBytes(value));
  return bytesToHex(new Uint8Array(digest));
}

/** 常量时间字符串比较，避免通过响应耗时侧信道推断 token */
export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

/**
 * PBKDF2-SHA256。
 *
 * 必须 ≤ 100000：Cloudflare Workers(workerd) 的 WebCrypto 对 PBKDF2 迭代次数有硬上限，
 * 超过会直接抛错 —— 也就是线上注册/登录全部失败。已有哈希在记录里保存了各自的迭代次数，
 * 校验时按记录值计算，因此调整默认值不影响老账号。
 */
export const DEFAULT_ITERATIONS = 100_000;
const KEY_BITS = 256;

/**
 * 登录「等时」用的假哈希：账号不存在时也跑一次同样迭代数的 PBKDF2，
 * 否则响应耗时会泄露邮箱是否已注册（实测差 ~50ms，可稳定枚举）。
 */
export const DUMMY_PASSWORD_HASH: PasswordHash = {
  // 32 字节全零 → base64url（43 字符）；16 字节全零盐 → base64url（22 字符）
  hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  salt: 'AAAAAAAAAAAAAAAAAAAAAA',
  iterations: DEFAULT_ITERATIONS,
};

/** 存储里的迭代数落后于当前默认值时，登录成功后应就地重哈希 */
export function needsRehash(stored: PasswordHash): boolean {
  return stored.iterations !== DEFAULT_ITERATIONS;
}

async function derive(password: string, salt: Bytes, iterations: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', utf8ToBytes(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  iterations = DEFAULT_ITERATIONS
): Promise<PasswordHash> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, iterations);
  return {
    hash: bytesToBase64Url(hash),
    salt: bytesToBase64Url(salt),
    iterations,
  };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const salt = base64UrlToBytes(stored.salt);
  const hash = await derive(password, salt, stored.iterations);
  return timingSafeEqual(bytesToBase64Url(hash), stored.hash);
}

function base64UrlToBytes(value: string): Bytes {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
