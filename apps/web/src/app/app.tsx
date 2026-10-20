import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../lib/auth';
import { navigate, requiresAuth, useRoute } from '../lib/router';
import { AdminPage } from '../pages/AdminPage';
import { DocumentPage } from '../pages/DocumentPage';
import { DocumentsPage } from '../pages/DocumentsPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { PosterEditor } from '../editors/poster/PosterEditor';
import { LandingPage } from '../pages/LandingPage';
import { LocalBoard } from '../pages/LocalBoard';
import { LocalDraftPage } from '../pages/LocalDraftPage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';
import { TopBar } from '../ui/TopBar';
import styles from '../ui/common.module.scss';

function NotFoundPage({ path }: { path: string }) {
  return (
    <div className={styles.page}>
      <TopBar />
      <div className={styles.content}>
        <div className={styles.listWrap} style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>页面不存在</h2>
          <p className={styles.hint}>路径 {path} 没有对应的页面。</p>
          <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => navigate('/')}>
            返回首页
          </button>
        </div>
      </div>
    </div>
  );
}

function Router() {
  const route = useRoute();
  const { user, loading } = useAuth();
  const needAuth = requiresAuth(route);

  // 默认要求登录：未登录访问受保护页面时跳登录页，并带上原地址，登录后跳回
  useEffect(() => {
    if (loading || !needAuth || user) return;
    const back = encodeURIComponent(window.location.pathname + window.location.search);
    navigate(`/login?redirect=${back}`, { replace: true });
  }, [loading, needAuth, user]);

  // 登录态未确定（或正在跳转）时不渲染页面，避免先闪出内容再跳走
  if (needAuth && (loading || !user)) {
    return <div className={styles.center}>{loading ? '加载中…' : '正在跳转到登录页…'}</div>;
  }

  switch (route.kind) {
    case 'home':
      return <LandingPage />;
    case 'image':
      return <PosterEditor />;
    case 'try':
      return <LocalDraftPage key={`try:${route.type}`} type={route.type} />;
    case 'local':
      // 独立入口（/local）：顶栏固定高度，画布区自适应剩余高度
      return (
        <div className={styles.appShell}>
          <TopBar />
          <div className={styles.appBody}>
            <LocalBoard />
          </div>
        </div>
      );
    case 'login':
      return <LoginPage />;
    case 'register':
      return <RegisterPage />;
    case 'forgot-password':
      return <ForgotPasswordPage />;
    case 'reset-password':
      return <ResetPasswordPage token={route.token} />;
    case 'verify-email':
      return <VerifyEmailPage token={route.token} />;
    case 'documents':
      return <DocumentsPage />;
    case 'document':
      return <DocumentPage key={`document:${route.id}`} kind="document" id={route.id} />;
    case 'share':
      return <DocumentPage key={`share:${route.token}`} kind="share" id={route.token} />;
    case 'admin':
      return <AdminPage />;
    default:
      return <NotFoundPage path={route.path} />;
  }
}

export function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}

export default App;
