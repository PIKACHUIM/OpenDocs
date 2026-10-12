import { useEffect, useMemo, useState } from 'react';

/**
 * 极简路由：不引入 react-router，仅靠 pathname 前缀判断。
 * 配合 Pages/EdgeOne 的 SPA 回退（/* -> /index.html 200）即可工作。
 *
 *   /                     本地白板（保留原有纯本地体验，不需要登录）
 *   /login /register      认证
 *   /forgot-password      发起找回密码
 *   /reset-password       凭 token 设置新密码（?token=）
 *   /verify-email         凭 token 验证邮箱（?token=）
 *   /documents            文档中心
 *   /d/:id                打开某个文档（按其 type 分发到对应编辑器）
 *   /s/:token             通过分享链接打开（无需登录）
 *   /admin                管理后台
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
  if (path === '/') return { kind: 'local' };
  if (path === '/login') return { kind: 'login' };
  if (path === '/register') return { kind: 'register' };
  if (path === '/forgot-password') return { kind: 'forgot-password' };
  if (path === '/reset-password') return { kind: 'reset-password', token: getQueryToken(search) };
  if (path === '/verify-email') return { kind: 'verify-email', token: getQueryToken(search) };
  if (path === '/documents') return { kind: 'documents' };
  if (path === '/admin') return { kind: 'admin' };

  const docMatch = /^\/d\/([^/]+)$/.exec(path);
  if (docMatch) return { kind: 'document', id: decodeURIComponent(docMatch[1]) };

  const shareMatch = /^\/s\/([^/]+)$/.exec(path);
  if (shareMatch) return { kind: 'share', token: decodeURIComponent(shareMatch[1]) };

  return { kind: 'notFound', path };
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
