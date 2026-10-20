import type { ResendConfig } from './settings';

/**
 * Resend 邮件发送。直接用 fetch 调 REST API（https://api.resend.com/emails），
 * 不引入 resend npm 包 —— 它内部依赖 Node 的东西较多，边缘运行时用 fetch 更省心也更可控。
 */
export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super('未配置 Resend：请在管理后台「系统设置」或环境变量 RESEND_API_KEY / RESEND_FROM 中配置');
    this.name = 'MailNotConfiguredError';
  }
}

/**
 * 返回「是否真的投递成功」。
 * 之前这里在未配置时只打日志并 resolve，调用方据此认为 emailSent=true，属于假成功；
 * 现在用布尔返回值让上层如实展示，同时仍不阻断注册/找回密码主流程。
 */
export async function sendEmail(config: ResendConfig, input: SendEmailInput): Promise<boolean> {
  if (!config.apiKey || !config.from) {
    // 本地开发/未配置 Resend 时打印到日志，不阻断注册等主流程
    console.warn('[mail] Resend 未配置，邮件改为打印日志：', {
      to: input.to,
      subject: input.subject,
    });
    return false;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend 发信失败 (${response.status})：${detail.slice(0, 300)}`);
  }
  return true;
}

/** 站点名、链接都来自可配置项，拼进 HTML 前必须转义（防管理端配置注入） */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(siteName: string, title: string, bodyHtml: string): string {
  const safeSite = escapeHtml(siteName);
  return `<!doctype html>
<html lang="zh-CN"><body style="margin:0;background:#f4f5f7;font-family:-apple-system,'Segoe UI',Roboto,'PingFang SC',sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
    <h2 style="margin:0 0 16px;color:#1f2329;font-size:18px;">${escapeHtml(title)}</h2>
    <div style="color:#3a3f47;font-size:14px;line-height:1.7;">${bodyHtml}</div>
    <p style="margin-top:28px;color:#9aa4b2;font-size:12px;">${safeSite} · 此邮件由系统自动发送，请勿回复</p>
  </div>
</body></html>`;
}

export function buildVerifyEmail(siteName: string, siteUrl: string, token: string) {
  const link = `${siteUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
  const safeLink = escapeHtml(link);
  return {
    subject: `验证你的 ${siteName} 账号邮箱`,
    html: layout(
      siteName,
      '验证邮箱',
      `<p>感谢注册 ${escapeHtml(siteName)}，请点击下方按钮完成邮箱验证（24 小时内有效）：</p>
       <p style="margin:24px 0;"><a href="${safeLink}" style="background:#4a6cf7;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">验证邮箱</a></p>
       <p>或复制链接到浏览器打开：<br/><span style="color:#4a6cf7;word-break:break-all;">${safeLink}</span></p>`
    ),
    text: `请在浏览器打开以下链接完成邮箱验证（24 小时内有效）：${link}`,
  };
}

export function buildResetPasswordEmail(siteName: string, siteUrl: string, token: string) {
  const link = `${siteUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  const safeLink = escapeHtml(link);
  return {
    subject: `重置你的 ${siteName} 账号密码`,
    html: layout(
      siteName,
      '重置密码',
      `<p>我们收到了重置密码的请求，请点击下方按钮设置新密码（1 小时内有效）：</p>
       <p style="margin:24px 0;"><a href="${safeLink}" style="background:#4a6cf7;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">重置密码</a></p>
       <p>如果不是你本人操作，请忽略此邮件，账号不会受到任何影响。</p>
       <p>或复制链接到浏览器打开：<br/><span style="color:#4a6cf7;word-break:break-all;">${safeLink}</span></p>`
    ),
    text: `请在浏览器打开以下链接重置密码（1 小时内有效）：${link}`,
  };
}
