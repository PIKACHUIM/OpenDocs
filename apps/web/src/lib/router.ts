import { useEffect, useMemo, useState } from 'react';

/**
 * 极简路由：不引入 react-router，仅靠 pathname 前缀判断。
 * 配合 Workers/EdgeOne 的 SPA 回退（未命中回退到 index.html）即可工作。
 *
 *   /                     主页 = 文档管理（需登录）
 *   /documents            / 的别名，保留兼容
 *   /local                本地白板（纯 IndexedDB，不经过后端）
 *   /login /register      认证
 *   /forgot-password      发起找回密码
 *   /reset-password       凭 token 设置新密码（?token=）
 *   /verify-email         凭 token 验证邮箱（?token=）
 *   /d/:id                打开某个文档（按其 type 分发到对应编辑器）
 *   /s/:token             通过分享链接打开（无需登录）
 *   /admin                管理后台
 *
 * 除下面 PUBLIC_ROUTE_KINDS 列出的路由外，其余页面一律要求已登录，
 * 未登录会被重定向到 /login?redirect=<原地址>。
 */
export type Route =
  | { kind: 'local' }
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

function getQueryToken(search: string): string {
  return new URLSearchParams(search).get('token') ?? '';
}

export function parseRoute(pathname: string, search = ''): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  // 主页就是文档管理；/documents 作为别名继续可用
  if (path === '/' || path === '/documents') return { kind: 'documents' };
  if (path === '/local') return { kind: 'local' };
  if (path === '/login') return { kind: 'login' };
  if (path === '/register') return { kind: 'register' };
  if (path === '/forgot-password') return { kind: 'forgot-password' };
  if (path === '/reset-password') return { kind: 'reset-password', token: getQueryToken(search) };
  if (path === '/verify-email') return { kind: 'verify-email', token: getQueryToken(search) };
  if (path === '/admin') return { kind: 'admin' };

  const docMatch = /^\/d\/([^/]+)$/.exec(path);
  if (docMatch) return { kind: 'document', id: decodeURIComponent(docMatch[1]) };

  const shareMatch = /^\/s\/([^/]+)$/.exec(path);
  if (shareMatch) return { kind: 'share', token: decodeURIComponent(shareMatch[1]) };

  return { kind: 'notFound', path };
}

/** 无需登录即可访问的路由。其余一律要求登录。 */
const PUBLIC_ROUTE_KINDS: ReadonlySet<Route['kind']> = new Set<Route['kind']>([
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
