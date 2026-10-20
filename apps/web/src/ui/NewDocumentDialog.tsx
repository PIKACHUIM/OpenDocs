import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  documentApi,
  type ApiDocument,
  type DocumentType,
} from '../api';
import { navigate } from '../lib/router';
import {
  BLANK_TEMPLATE_ID,
  DOC_TYPE_LABEL,
  templatesFor,
} from '../lib/templates';
import { Modal } from './Modal';
import styles from './common.module.scss';

const RECENT_SIZE = 6;

const TYPE_BADGE: Record<DocumentType, { text: string; fg: string; bg: string }> = {
  mindmap: { text: '板', fg: '#3370ff', bg: '#eef3ff' },
  markdown: { text: 'MD', fg: '#6f4bd8', bg: '#f3efff' },
  word: { text: 'W', fg: '#1a56c4', bg: '#eaf1fe' },
  excel: { text: 'X', fg: '#0f7b45', bg: '#e9f7ef' },
  ppt: { text: 'P', fg: '#c2500f', bg: '#fdf0e8' },
  image: { text: '图', fg: '#b5487a', bg: '#fdeff5' },
};

function formatTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < day * 7) return `${Math.floor(diff / day)} 天前`;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

interface NewDocumentDialogProps {
  /** 为 null 时弹窗关闭 */
  type: DocumentType | null;
  onClose: () => void;
  /** 新建到哪个目录；null / 不传表示根目录 */
  folderId?: string | null;
}

/**
 * 新建文档弹窗（顶栏各类型入口、文档管理的「+ 新建」共用）。
 *
 * 点击类型入口不再直接建空文档，而是先给出两条路：
 *   1. 最近文档：列表里点一下直接打开（该类型、按最近打开排序）
 *   2. 选模板新建：默认选中「空白文档」，选好后点创建
 */
export function NewDocumentDialog({ type, onClose, folderId = null }: NewDocumentDialogProps) {
  const [recent, setRecent] = useState<ApiDocument[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [templateId, setTemplateId] = useState(BLANK_TEMPLATE_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templates = useMemo(() => (type ? templatesFor(type) : []), [type]);
  const selected = templates.find((item) => item.id === templateId) ?? templates[0];

  // 换类型时重置选择，并拉该类型的最近文档
  useEffect(() => {
    setTemplateId(BLANK_TEMPLATE_ID);
    setError(null);
    if (!type) return;
    let alive = true;
    setLoadingRecent(true);
    documentApi
      .list({ type, recent: true, pageSize: RECENT_SIZE })
      .then((data) => {
        if (alive) setRecent(data.documents);
      })
      .catch((caught) => {
        if (alive) setError(caught instanceof ApiError ? caught.message : '最近文档加载失败');
      })
      .finally(() => {
        if (alive) setLoadingRecent(false);
      });
    return () => {
      alive = false;
    };
  }, [type]);

  const create = async () => {
    if (!type || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const content = await selected.build();
      const data = await documentApi.create({
        type,
        title: selected.title ?? `未命名${DOC_TYPE_LABEL[type]}`,
        content,
        folderId,
      });
      onClose();
      navigate(`/d/${data.document.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  const openRecent = (doc: ApiDocument) => {
    onClose();
    navigate(`/d/${doc.id}`);
  };

  const label = type ? DOC_TYPE_LABEL[type] : '';
  /** 西文类型名（Word / Excel / Markdown）前面留空格，中文不留 */
  const spacedLabel = /^[A-Za-z]/.test(label) ? ` ${label}` : label;
  const badge = type ? TYPE_BADGE[type] : null;

  return (
    <Modal
      open={!!type}
      title={`新建${spacedLabel}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className={styles.hint} style={{ marginRight: 'auto' }}>
            模板只是初始内容，创建后可以随意修改
          </span>
          <button type="button" className={styles.button} onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={() => void create()}
            disabled={busy || !selected}
          >
            {busy ? '创建中…' : `创建${selected ? `「${selected.name}」` : ''}`}
          </button>
        </>
      }
    >
      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.dialogSection}>
        <header className={styles.dialogSectionHeader}>
          <span className={styles.dialogSectionTitle}>最近文档</span>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonGhost} ${styles.buttonSm}`}
            onClick={() => {
              onClose();
              navigate('/documents');
            }}
          >
            全部文档
          </button>
        </header>

        {loadingRecent ? (
          <p className={styles.hint}>加载中…</p>
        ) : recent.length === 0 ? (
          <p className={styles.hint}>还没有{label}文档，选个模板开始第一篇吧。</p>
        ) : (
          <div className={styles.recentList}>
            {recent.map((doc) => (
              <button
                key={doc.id}
                type="button"
                className={styles.recentItem}
                onClick={() => openRecent(doc)}
                title={doc.title}
              >
                <span
                  className={styles.docIcon}
                  style={badge ? { color: badge.fg, background: badge.bg } : undefined}
                >
                  {badge?.text}
                </span>
                <span className={styles.recentItemTitle}>{doc.title}</span>
                <span className={styles.recentItemTime}>
                  {formatTime(doc.lastOpenedAt ?? doc.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={styles.dialogSection} style={{ marginBottom: 0 }}>
        <header className={styles.dialogSectionHeader}>
          <span className={styles.dialogSectionTitle}>选择模板</span>
        </header>
        <div className={styles.templateGrid}>
          {templates.map((template) => {
            const active = selected?.id === template.id;
            return (
              <button
                key={template.id}
                type="button"
                className={`${styles.templateCard} ${active ? styles.templateCardActive : ''}`}
                aria-pressed={active}
                onClick={() => setTemplateId(template.id)}
              >
                <span className={styles.templateCardTitle}>{template.name}</span>
                {template.hint ? (
                  <span className={styles.templateCardHint}>{template.hint}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {type === 'word' || type === 'excel' ? (
          <p className={styles.hint} style={{ marginTop: 10 }}>
            这两类文档的模板正在整理，先提供空白模板。
          </p>
        ) : null}
      </section>
    </Modal>
  );
}
