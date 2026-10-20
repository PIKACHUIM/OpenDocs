import { tooManyRequests } from './http';

/**
 * 进程内滑动窗口限流（最佳努力）。
 *
 * 为什么不做成分布式：Durable Object / KV 会引入额外的绑定与成本，而本项目
 * 希望「一份代码跑 Workers / EdgeOne / 本地」。这里按 isolate 计数，能挡住
 * 单实例上的爆破与邮件轰炸；跨实例的强一致限流建议在边缘层另配规则
 * （Cloudflare Rate Limiting、EdgeOne 频控）。
 *
 * 注意：这里刻意只保留计数，不存任何用户输入，避免内存被当作存储滥用。
 */
interface RateLimitRule {
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大次数 */
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
/** 兜底上限，防止被大量随机 key 打爆内存 */
const MAX_BUCKETS = 5000;

function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // 极端情况下仍然超限：直接清空，宁可短暂放宽也不拖垮实例
  if (buckets.size > MAX_BUCKETS) buckets.clear();
}

/** 消耗一次配额；返回 false 表示已超出 */
export function consumeRateLimit(key: string, rule: RateLimitRule): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) prune(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  if (existing.count >= rule.max) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }

  existing.count += 1;
  return { allowed: true, retryAfter: 0 };
}

/** 超出配额时直接抛 429，文案里带重试秒数 */
export function enforceRateLimit(key: string, rule: RateLimitRule): void {
  const result = consumeRateLimit(key, rule);
  if (!result.allowed) {
    throw tooManyRequests(`操作过于频繁，请 ${result.retryAfter} 秒后再试`);
  }
}

/** 常用规则，集中在这里便于审计与调参 */
export const RATE_LIMITS = {
  loginIp: { windowMs: 60_000, max: 20 },
  loginAccount: { windowMs: 60_000, max: 8 },
  registerIp: { windowMs: 60 * 60_000, max: 10 },
  forgotIp: { windowMs: 15 * 60_000, max: 5 },
  forgotAccount: { windowMs: 60 * 60_000, max: 5 },
  authTokenIp: { windowMs: 15 * 60_000, max: 20 },
  shareRead: { windowMs: 60_000, max: 120 },
  teamJoin: { windowMs: 60_000, max: 10 },
  uploadUser: { windowMs: 60 * 60_000, max: 120 },
  uploadIp: { windowMs: 60 * 60_000, max: 200 },
  userSearch: { windowMs: 60_000, max: 60 },
  adminWrite: { windowMs: 60_000, max: 120 },
} as const;
