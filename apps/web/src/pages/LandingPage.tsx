import { useState } from 'react';
import { documentApi, emptyContentFor, ApiError, type DocumentType } from '../api';
import { useAuth } from '../lib/auth';
import { navigate, type TryType } from '../lib/router';
import styles from '../ui/common.module.scss';

interface Entry {
  type: DocumentType;
  title: string;
  desc: string;
  badge: string;
  fg: string;
  bg: string;
}

const ENTRIES: Entry[] = [
  {
    type: 'mindmap',
    title: '白板 / 思维导图',
    desc: '无限画布，把想法随手铺开再慢慢收敛',
    badge: '板',
    fg: '#3370ff',
    bg: '#eef3ff',
  },
  {
    type: 'word',
    title: 'Word 文档',
    desc: '标题、列表、表格、图片，还能嵌入思维导图',
    badge: 'W',
    fg: '#1a56c4',
    bg: '#eaf1fe',
  },
  {
    type: 'excel',
    title: 'Excel 表格',
    desc: '公式、单元格格式与多工作表',
    badge: 'X',
    fg: '#0f7b45',
    bg: '#e9f7ef',
  },
  {
    type: 'ppt',
    title: '演示文稿',
    desc: '分页编辑幻灯片，可导出为 .pptx',
    badge: 'P',
    fg: '#c2500f',
    bg: '#fdf0e8',
  },
  {
    type: 'markdown',
    title: 'Markdown',
    desc: '源码编辑与实时预览，适合技术文档',
    badge: 'MD',
    fg: '#6f4bd8',
    bg: '#f3efff',
  },
];

/**
 * 公开首页。
 *
 * 定位是「导航页」而不是营销页：一屏之内给出各编辑器的入口，
 * 未登录也能点进去试用（草稿存在本地，登录后可一键保存到账号）。
 */
export function LandingPage() {
  const { user, config, loading } = useAuth();
  const [busy, setBusy] = useState(false);

  const siteName = config?.siteName ?? 'OpenDocs';

  const startEditing = async (type: DocumentType) => {
    // 已登录：直接建一份云端文档；未登录：进入本地试用
    if (!user) {
      navigate(`/try/${type as TryType}`);
      return;
    }
    setBusy(true);
    try {
      const data = await documentApi.create({
        type,
        title: `未命名${type === 'mindmap' ? '白板' : ''}`.trim() || '未命名文档',
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
    <div className={styles.landing}>
      <header className={styles.landingHeader}>
        <span className={styles.landingBrand} onClick={() => navigate('/')}>
          {siteName}
        </span>
        <nav className={styles.landingNav}>
          <button type="button" className={styles.landingNavItem} onClick={() => navigate('/local')}>
            本地白板
          </button>
          <button type="button" className={styles.landingNavItem} onClick={() => navigate('/documents')}>
            我的文档
          </button>
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

      <section className={styles.hero}>
        <span className={styles.heroEyebrow}>免登录即可试用</span>
        <h1 className={styles.heroTitle}>从想法到交付，都在一份文档里完成</h1>
        <p className={styles.heroSub}>
          白板、文档、表格、演示与 Markdown 共用一套账号与分享体系。
          先试用，觉得顺手再保存到云端。
        </p>
        <div className={styles.heroActions}>
          <button
            type="button"
            className={styles.heroPrimary}
            disabled={busy}
            onClick={() => navigate(user ? '/documents' : '/register')}
          >
            {user ? '进入工作台' : '免费开始使用'}
          </button>
          <button type="button" className={styles.heroSecondary} onClick={() => navigate('/local')}>
            免登录试用白板
          </button>
        </div>
      </section>

      <section className={styles.entrySection}>
        <div className={styles.entryGrid}>
          {ENTRIES.map((entry) => (
            <button
              key={entry.type}
              type="button"
              className={styles.entryCard}
              disabled={busy}
              onClick={() => startEditing(entry.type)}
            >
              <span
                className={styles.entryIcon}
                style={{ color: entry.fg, background: entry.bg }}
                aria-hidden
              >
                {entry.badge}
              </span>
              <div className={styles.entryTitle}>{entry.title}</div>
              <div className={styles.entryDesc}>{entry.desc}</div>
            </button>
          ))}
        </div>
      </section>

      <footer className={styles.landingFooter}>
        {siteName} · 免登录试用模式下，内容只保存在当前浏览器，登录后才会同步到云端。
      </footer>
    </div>
  );
}
