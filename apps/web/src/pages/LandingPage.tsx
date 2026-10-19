import { useState } from 'react';
import { ApiError, documentApi, emptyContentFor, type DocumentType } from '../api';
import { useAuth } from '../lib/auth';
import { navigate, type TryType } from '../lib/router';
import { LocalBoard } from './LocalBoard';
import styles from '../ui/common.module.scss';

type Tab = 'board' | 'word' | 'excel' | 'markdown' | 'image';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'board', label: '在线白板' },
  { key: 'word', label: 'Word 文档' },
  { key: 'excel', label: 'Excel 表格' },
  { key: 'markdown', label: 'Markdown' },
  { key: 'image', label: '图片编辑' },
];

const INTRO: Record<Exclude<Tab, 'board'>, { type: DocumentType; title: string; desc: string }> = {
  word: {
    type: 'word',
    title: 'Word 文档',
    desc: '标题、列表、引用、表格、图片，还能把思维导图直接嵌进正文。',
  },
  excel: {
    type: 'excel',
    title: 'Excel 表格',
    desc: '公式、数字格式、多工作表，基于 Univer 的完整表格引擎。',
  },
  markdown: {
    type: 'markdown',
    title: 'Markdown',
    desc: '源码编辑与实时预览，适合技术文档与长文写作。',
  },
  image: {
    type: 'markdown',
    title: '图片编辑',
    desc: '封面、引用、清单模板，图层化编辑并导出 PNG。',
  },
};

/**
 * 首页：以「在线白板」为默认标签页的工作台。
 *
 * 结构与管理后台一致：顶栏 + 横向 tab + 内容区。
 * 白板 tab 直接内嵌编辑器，其他类型放在独立 tab 里，点击即可新建或试用。
 */
export function LandingPage() {
  const { user, config, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('board');
  const [busy, setBusy] = useState(false);

  const siteName = config?.siteName ?? 'OpenDocs';

  const startDocument = async (type: DocumentType) => {
    if (!user) {
      navigate(`/try/${type as TryType}`);
      return;
    }
    setBusy(true);
    try {
      const data = await documentApi.create({
        type,
        title: '未命名文档',
        content: emptyContentFor(type),
      });
      navigate(`/d/${data.document.id}`);
    } catch (error) {
      window.alert(error instanceof ApiError ? error.message : '创建文档失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.workspaceShell}>
      <header className={styles.landingHeader}>
        <span className={styles.landingBrand} onClick={() => setTab('board')}>
          {siteName}
        </span>
        <nav className={styles.landingNav}>
          <button type="button" className={styles.landingNavItem} onClick={() => navigate('/documents')}>
            我的文档
          </button>
          {user ? (
            <button type="button" className={styles.landingNavItem} onClick={() => navigate('/admin')}>
              管理后台
            </button>
          ) : null}
        </nav>
        <span className={styles.grow} />
        {loading ? null : user ? (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={() => navigate('/documents')}
          >
            进入工作台
          </button>
        ) : (
          <>
            <button type="button" className={styles.button} onClick={() => navigate('/login')}>
              登录
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => navigate('/register')}
            >
              免费注册
            </button>
          </>
        )}
      </header>

      <div className={styles.workspaceBody}>
        <div className={styles.tabs}>
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`${styles.tab} ${tab === item.key ? styles.tabActive : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className={styles.workspacePanel}>
          {tab === 'board' ? (
            <LocalBoard />
          ) : (
            <div className={styles.panelEmpty}>
              <h2 className={styles.panelTitle}>{INTRO[tab].title}</h2>
              <p className={styles.panelDesc}>{INTRO[tab].desc}</p>
              <div className={styles.row} style={{ justifyContent: 'center', marginTop: 18 }}>
                {tab === 'image' ? (
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonPrimary}`}
                    onClick={() => navigate('/image')}
                  >
                    打开图片编辑
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.buttonPrimary}`}
                      disabled={busy}
                      onClick={() => void startDocument(INTRO[tab].type)}
                    >
                      {user ? '新建文档' : '免登录试用'}
                    </button>
                    {user ? (
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() => navigate('/documents')}
                      >
                        我的文档
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
