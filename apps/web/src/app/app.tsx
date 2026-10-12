import { useCallback, useEffect, useState } from 'react';
import { Drawnix, DrawnixToolState, ColorScheme, ColorTheme } from '@drawnix/drawnix';
import localforage from 'localforage';
import { AuthProvider } from '../lib/auth';
import { navigate, useRoute } from '../lib/router';
import { AdminPage } from '../pages/AdminPage';
import { DocumentPage } from '../pages/DocumentPage';
import { DocumentsPage } from '../pages/DocumentsPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';
import { CloudEntry } from '../ui/CloudEntry';
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
 * `/` 继续保持纯本地白板体验，与接入账号体系/云端文档之前完全一致——
 * 不登录也能用，数据只存在浏览器 IndexedDB 里。
 * 云端的「文档中心」「思维导图/Markdown/Word/Excel/PPT」在 /documents 与 /d/:id 下，
 * 二者是两条独立的入口，互不影响。
 */
function LocalWhiteboard() {
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

  if (!loaded) return null;

  return (
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

  switch (route.kind) {
    case 'local':
      return (
        <>
          <LocalWhiteboard />
          <CloudEntry />
        </>
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
