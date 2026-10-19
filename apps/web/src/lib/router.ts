import { useEffect, useMemo, useState } from 'react';

/**
 * 极简路由：不引入 react-router，仅靠 pathname 前缀判断。
 * 配合 Workers/EdgeOne 的 SPA 回退（未命中回退到 index.html）即可工作。
 *
 *   /                     公开首页（导航 + 产品介绍 + 各编辑器入口）
 *   /documents            文档管理（需登录）
 *   /local                本地白板（免登录，数据在 IndexedDB）
 *   /try/:type            免登录试用某个编辑器（草稿存本地，可一键保存到账号）
 *   /login /register      认证
 *   /forgot-password      发起找回密码
 *   /reset-password       凭 token 设置新密码（?token=）
 *   /verify-email         凭 token 验证邮箱（?token=）
 *   /d/:id                打开某个云端文档
 *   /s/:token             通过分享链接打开（无需登录）
 *   /admin                管理后台
 *
 * 除 PUBLIC_ROUTE_KINDS 列出的路由外，其余页面要求已登录，
 * 未登录会被重定向到 /login?redirect=<原地址>。
 */

export type TryType = 'mindmap' | 'markdown' | 'word' | 'excel' | 'ppt';

export type Route =
  | { kind: 'home' }
  | { kind: 'local' }
  | { kind: 'image' }
  | { kind: 'try'; type: TryType }
  | { kind: 'login' }
  | { kind: 'register' }
  | { kind: 'forgot-password' }
  | { kind: 'reset-password'; token: string }
  | { kind: 'verify-email'; token: string }
  | { kind: 'documents' }
  | { kind: 'document'; id: string }
  | { kind: 'share'; token: string }
  | { kind: 'admin' }
  | { kind: 'notFound'; path: string };

const TRY_TYPES: TryType[] = ['mindmap', 'markdown', 'word', 'excel', 'ppt'];

function getQueryToken(search: string): string {
  return new URLSearchParams(search).get('token') ?? '';
}

export function parseRoute(pathname: string, search = ''): Route {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return { kind: 'home' };
  if (path === '/documents') return { kind: 'documents' };
  if (path === '/local') return { kind: 'local' };
  if (path === '/image') return { kind: 'image' };
  if (path === '/login') return { kind: 'login' };
  if (path === '/register') return { kind: 'register' };
  if (path === '/forgot-password') return { kind: 'forgot-password' };
  if (path === '/reset-password') return { kind: 'reset-password', token: getQueryToken(search) };
  if (path === '/verify-email') return { kind: 'verify-email', token: getQueryToken(search) };
  if (path === '/admin') return { kind: 'admin' };

  const tryMatch = /^\/try\/([^/]+)$/.exec(path);
  if (tryMatch) {
    const type = decodeURIComponent(tryMatch[1]) as TryType;
    if (TRY_TYPES.includes(type)) return { kind: 'try', type };
  }

  const docMatch = /^\/d\/([^/]+)$/.exec(path);
  if (docMatch) return { kind: 'document', id: decodeURIComponent(docMatch[1]) };

  const shareMatch = /^\/s\/([^/]+)$/.exec(path);
  if (shareMatch) return { kind: 'share', token: decodeURIComponent(shareMatch[1]) };

  return { kind: 'notFound', path };
}

/** 无需登录即可访问的路由。其余一律要求登录。 */
const PUBLIC_ROUTE_KINDS: ReadonlySet<Route['kind']> = new Set<Route['kind']>([
  'home',
  'local',
  'image',
  'try',
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'verify-email',
  // 分享链接本就是给未登录用户看的
  'share',
]);

export function requiresAuth(route: Route): boolean {
  return !PUBLIC_ROUTE_KINDS.has(route.kind);
}

/**
 * 读取登录后要跳回的地址（由 /login?redirect=... 传入）。
 * 只接受站内路径，避免被构造成跳转到外站的开放重定向。
 */
export function getRedirectTarget(): string | null {
  const raw = new URLSearchParams(window.location.search).get('redirect');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

const NAVIGATE_EVENT = 'drawnix:navigate';

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (options.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  // pushState 不会触发 popstate，手动通知订阅者
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function useRoute(): Route {
  const [state, setState] = useState(() =>
    typeof window === 'undefined'
      ? { pathname: '/', search: '' }
      : { pathname: window.location.pathname, search: window.location.search }
  );

  useEffect(() => {
    const sync = () => setState({ pathname: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', sync);
    window.addEventListener(NAVIGATE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAVIGATE_EVENT, sync);
    };
  }, []);

  return useMemo(() => parseRoute(state.pathname, state.search), [state]);
}
