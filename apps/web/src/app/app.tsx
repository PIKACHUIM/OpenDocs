import { useCallback, useEffect, useState } from 'react';
import { Drawnix, DrawnixToolState, ColorScheme, ColorTheme } from '@drawnix/drawnix';
import localforage from 'localforage';
import { ApiError, documentApi, type MindmapContent } from '../api';
import { AuthProvider, useAuth } from '../lib/auth';
import { navigate, requiresAuth, useRoute } from '../lib/router';
import { AdminPage } from '../pages/AdminPage';
import { DocumentPage } from '../pages/DocumentPage';
import { DocumentsPage } from '../pages/DocumentsPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { ImageEditorPage } from '../pages/ImageEditorPage';
import { LandingPage } from '../pages/LandingPage';
import { LocalDraftPage } from '../pages/LocalDraftPage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';
import { TopBar } from '../ui/TopBar';
import styles from '../ui/common.module.scss';

type Language = 'zh' | 'en' | 'ru' | 'ar' | 'vi';

type MainBoardPreference = {
  language: Language;
  copyTransparent: boolean;
  exportTransparent: boolean;
  colorScheme: ColorScheme;
  colorTheme: ColorTheme;
};

type AppValue = {
  children: unknown[];
  viewport?: unknown;
  theme?: unknown;
};

const MAIN_BOARD_CONTENT_KEY = 'main_board_content';
const MAIN_BOARD_TOOL_STATE_KEY = 'main_board_tool_state';
const MAIN_BOARD_PREFERENCE_KEY = 'main_board_preference';

localforage.config({
  name: 'Drawnix',
  storeName: 'drawnix_store',
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

/**
 * 本地白板（`/local`）。
 *
 * 编辑过程完全离线：内容写 IndexedDB，不产生网络请求，未登录也能用。
 * 另有「保存到我的文档」把当前画布转成一份云端文档（mindmap 类型），
 * 之后在 `/d/:id` 里继续编辑——本地与云端共用同一个 Drawnix 编辑器，
 * 差别只在存储位置，不再有两条割裂的链路。
 */
function LocalWhiteboard() {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState<AppValue>({ children: [] });
  const [initialToolState, setInitialToolState] = useState<Partial<DrawnixToolState>>();
  const [preference, setPreference] = useState<MainBoardPreference>({
    language: 'zh',
    copyTransparent: false,
    exportTransparent: false,
    colorScheme: 'light',
    colorTheme: 'blue',
  });
  const [loaded, setLoaded] = useState(false);
  const [tutorial, setTutorial] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [storedData, storedToolState, storedPreference] = await Promise.all([
        localforage.getItem(MAIN_BOARD_CONTENT_KEY),
        localforage.getItem(MAIN_BOARD_TOOL_STATE_KEY),
        localforage.getItem(MAIN_BOARD_PREFERENCE_KEY),
      ]);
      if (cancelled) return;
      if (storedData) {
        const appValue = storedData as AppValue;
        setValue(appValue);
        if (!appValue.children?.length) setTutorial(true);
      } else {
        setTutorial(true);
      }
      if (storedToolState) setInitialToolState(storedToolState as Partial<DrawnixToolState>);
      if (storedPreference) {
        setPreference((current) => ({
          ...current,
          ...(storedPreference as Partial<MainBoardPreference>),
        }));
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updatePreference = useCallback((partial: Partial<MainBoardPreference>) => {
    setPreference((current) => {
      const next = { ...current, ...partial };
      void localforage.setItem(MAIN_BOARD_PREFERENCE_KEY, next);
      return next;
    });
  }, []);

  /** 把当前画布另存为一份云端文档 */
  const saveToAccount = async () => {
    if (!user) {
      navigate('/login?redirect=%2Flocal');
      return;
    }
    setSaving(true);
    try {
      // 本地白板与云端 mindmap 文档结构一致（elements / viewport / theme），可直接转换
      const content = {
        elements: value.children ?? [],
        viewport: value.viewport,
        theme: value.theme,
      } as unknown as MindmapContent;

      const data = await documentApi.create({
        type: 'mindmap',
        title: '未命名白板',
        content,
      });
      navigate(`/d/${data.document.id}`);
    } catch (error) {
      window.alert(error instanceof ApiError ? error.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <>
      <div className={styles.floatAction}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          disabled={saving}
          onClick={saveToAccount}
        >
          {saving ? '保存中…' : user ? '保存到我的文档' : '登录后保存到云端'}
        </button>
      </div>
      <Drawnix
      value={value.children as never}
      viewport={value.viewport as never}
      theme={value.theme as never}
      initialToolState={initialToolState}
      initialLanguage={preference.language}
      initialColorScheme={preference.colorScheme}
      initialColorTheme={preference.colorTheme}
      initialPreference={{
        copyTransparent: preference.copyTransparent,
        exportTransparent: preference.exportTransparent,
      }}
      onLanguageChange={(language) => updatePreference({ language })}
      onColorSchemeChange={(colorScheme) => updatePreference({ colorScheme })}
      onColorThemeChange={(colorTheme) => updatePreference({ colorTheme })}
      onPreferenceChange={({ copyTransparent, exportTransparent }) =>
        updatePreference({ copyTransparent, exportTransparent })
      }
      onChange={(next) => {
        const newValue = next as unknown as AppValue;
        setValue(newValue);
        if (newValue.children?.length) setTutorial(false);
        void localforage.setItem(MAIN_BOARD_CONTENT_KEY, newValue);
      }}
      onToolStateChange={(toolState) => {
        void localforage.setItem(MAIN_BOARD_TOOL_STATE_KEY, toolState);
      }}
        tutorial={tutorial}
      />
    </>
  );
}

function NotFoundPage({ path }: { path: string }) {
  return (
    <div className={styles.page}>
      <TopBar />
      <div className={styles.content}>
        <div className={styles.listWrap} style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>页面不存在</h2>
          <p className={styles.hint}>路径 {path} 没有对应的页面。</p>
          <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => navigate('/documents')}>
            返回文档中心
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
      return <ImageEditorPage />;
    case 'try':
      return <LocalDraftPage key={`try:${route.type}`} type={route.type} />;
    case 'local':
      // 本地白板（/local）：顶栏固定高度，画布区自适应剩余高度
      return (
        <div className={styles.appShell}>
          <TopBar />
          <div className={styles.appBody}>
            <LocalWhiteboard />
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
