import { alertDialog } from '../ui/dialog';
import { useCallback, useEffect, useState } from 'react';
import { Drawnix, type DrawnixToolState, type ColorScheme, type ColorTheme } from '@drawnix/drawnix';
import localforage from 'localforage';
import { ApiError, documentApi, type MindmapContent } from '../api';
import { useAuth } from '../lib/auth';
import { navigate } from '../lib/router';
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
 * 在线白板（本地存储）。
 *
 * 编辑过程完全离线：内容写 IndexedDB，不产生网络请求，未登录也能用。
 * 「保存到我的文档」把当前画布转成一份云端文档（mindmap 类型），之后在 `/d/:id`
 * 继续编辑——本地与云端共用同一个 Drawnix 编辑器，差别只在存储位置。
 *
 * 首页（`/`）与 `/local` 都用这个组件：首页把它放在「在线白板」tab 里。
 */
export function LocalBoard() {
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
      void alertDialog(error instanceof ApiError ? error.message : '保存失败，请重试');
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
