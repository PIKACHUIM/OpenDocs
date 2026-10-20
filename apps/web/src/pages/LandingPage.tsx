import { useState } from 'react';
import { ApiError, documentApi, emptyContentFor, type DocumentType } from '../api';
import { useAuth } from '../lib/auth';
import { navigate, type TryType } from '../lib/router';
import { TopBar } from '../ui/TopBar';
import styles from '../ui/common.module.scss';

interface Entry {
  type: DocumentType | 'image';
  title: string;
  desc: string;
  badge: string;
  fg: string;
  bg: string;
}

const ENTRIES: Entry[] = [
  {
    type: 'mindmap',
    title: '在线白板',
    desc: '无限画布，把想法随手铺开再慢慢收敛',
    badge: '板',
    fg: '#3370ff',
    bg: '#eef3ff',
  },
  {
    type: 'word',
    title: 'Word 文档',
    desc: '标题、列表、表格、图片，排版接近 Word',
    badge: 'W',
    fg: '#1a56c4',
    bg: '#eaf1fe',
  },
  {
    type: 'excel',
    title: 'Excel 表格',
    desc: '公式、数字格式与多工作表',
    badge: 'X',
    fg: '#0f7b45',
    bg: '#e9f7ef',
  },
  {
    type: 'ppt',
    title: '演示文稿',
    desc: '自由画布排版幻灯片，可放映与导出 pptx',
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
  {
    type: 'image',
    title: '图片编辑',
    desc: '模板、图层、对齐与 PNG 导出',
    badge: '图',
    fg: '#b5487a',
    bg: '#fdeff5',
  },
];

/**
 * 门户首页：介绍 + 各编辑器入口。
 * 顶栏与文档中心、管理后台共用 TopBar，保证三处样式一致。
 */
export function LandingPage() {
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);

  const start = async (entry: Entry) => {
    if (entry.type === 'image') {
      navigate('/image');
      return;
    }
    if (!user) {
      navigate(`/try/${entry.type as TryType}`);
      return;
    }
    setBusy(true);
    try {
      const data = await documentApi.create({
        type: entry.type,
        title: entry.title === '在线白板' ? '未命名白板' : `未命名${entry.title}`,
        content: emptyContentFor(entry.type),
      });
      navigate(`/d/${data.document.id}`);
    } catch (error) {
      window.alert(error instanceof ApiError ? error.message : '创建文档失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <TopBar />

      <section className={styles.hero}>
        <span className={styles.heroEyebrow}>免登录即可试用</span>
        <h1 className={styles.heroTitle}>从想法到交付，都在一份文档里完成</h1>
        <p className={styles.heroSub}>
          白板、文档、表格、演示与图片编辑共用一套账号、目录与分享体系。
          先试用，觉得顺手再保存到云端。
        </p>
        <div className={styles.heroActions}>
          <button
            type="button"
            className={styles.heroPrimary}
            disabled={busy || loading}
            onClick={() => navigate(user ? '/documents' : '/register')}
          >
            {user ? '进入工作台' : '免费开始使用'}
          </button>
          <button type="button" className={styles.heroSecondary} onClick={() => navigate('/local')}>
            打开在线白板
          </button>
        </div>
      </section>

      <section className={styles.entrySection}>
        <div className={styles.entryGrid}>
          {ENTRIES.map((entry) => (
            <button
              key={entry.title}
              type="button"
              className={styles.entryCard}
              disabled={busy}
              onClick={() => void start(entry)}
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
        <div>免登录试用模式下，内容只保存在当前浏览器；登录后才会同步到云端。</div>
        <div style={{ marginTop: 6 }}>
          本站基于 AGPL-3.0 开源软件 OpenDocs 运行，使用者有权获取对应源码 ·{' '}
          <a href="/LICENSE.txt" target="_blank" rel="noopener noreferrer">
            许可证全文
          </a>
        </div>
      </footer>
    </div>
  );
}
