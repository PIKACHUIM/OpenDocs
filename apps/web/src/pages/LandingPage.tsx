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
  /** 卡片上的能力要点，3 条以内 */
  points: string[];
  badge: string;
  fg: string;
  bg: string;
}

const ENTRIES: Entry[] = [
  {
    type: 'mindmap',
    title: '在线白板',
    desc: '无限画布，先把想法随手铺开，再慢慢收敛成结构。',
    points: ['无限画布与自由缩放', '思维导图、流程图、手绘标注', '自动保存到本地或云端'],
    badge: '板',
    fg: '#3370ff',
    bg: '#eef3ff',
  },
  {
    type: 'word',
    title: 'Word 文档',
    desc: '接近桌面 Word 的排版体验，适合正式文档与长文写作。',
    points: ['标题、列表、表格、图片', '字体字号与段落格式', '导出 .docx 与 PDF'],
    badge: 'W',
    fg: '#1a56c4',
    bg: '#eaf1fe',
  },
  {
    type: 'excel',
    title: 'Excel 表格',
    desc: '内置公式引擎，日常统计与数据处理够用。',
    points: ['完整公式与数字格式', '多工作表与筛选', '导出 .xlsx'],
    badge: 'X',
    fg: '#0f7b45',
    bg: '#e9f7ef',
  },
  {
    type: 'ppt',
    title: '演示文稿',
    desc: '自由画布排版幻灯片，元素可以随意摆放与对齐。',
    points: ['文字、形状、图表、公式、音视频', '进入动画与页面切换', '全屏放映与 .pptx 导出'],
    badge: 'P',
    fg: '#c2500f',
    bg: '#fdf0e8',
  },
  {
    type: 'markdown',
    title: 'Markdown',
    desc: '源码与实时预览并排，写技术文档最顺手。',
    points: ['格式工具栏一键排版', '可嵌入可编辑的思维导图', '拖入图片自动上传'],
    badge: 'MD',
    fg: '#6f4bd8',
    bg: '#f3efff',
  },
  {
    type: 'image',
    title: '图片编辑',
    desc: '做封面、海报、配图，图层化编辑所见即所得。',
    points: ['文字、形状、图片、二维码、画笔', '图层管理与对齐分布', '导出 PNG / JPG'],
    badge: '图',
    fg: '#b5487a',
    bg: '#fdeff5',
  },
];

/** 项目地址：如果仓库迁移，改这里一处即可 */
const PROJECT_URL = 'https://github.com/PIKACHUIM/drawnix';

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
              <ul className={styles.entryPoints}>
                {entry.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <span className={styles.entryAction}>开始使用 →</span>
            </button>
          ))}
        </div>
      </section>

      <footer className={styles.landingFooter}>
        <div className={styles.footerBrand}>Open Docs</div>
        <div className={styles.footerLine}>
          © {new Date().getFullYear()} Open Docs，保留一切权利。
        </div>
        <div className={styles.footerLine}>
          基于{' '}
          <a
            className={styles.footerLink}
            href="https://www.gnu.org/licenses/agpl-3.0.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            AGPL-3.0
          </a>{' '}
          许可发布 ·{' '}
          <a
            className={styles.footerLink}
            href="/LICENSE.txt"
            target="_blank"
            rel="noopener noreferrer"
          >
            许可证全文
          </a>{' '}
          ·{' '}
          <a
            className={styles.footerLink}
            href={PROJECT_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            项目地址
          </a>
        </div>
        <div className={styles.footerLine}>
          免登录试用模式下，内容只保存在当前浏览器；登录后才会同步到云端。
        </div>
      </footer>
    </div>
  );
}
