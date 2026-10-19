import { useEffect, useState, type ReactNode } from 'react';
import type { ApiDocument, DocumentType } from '../api';
import { navigate } from '../lib/router';
import type { SyncStatus } from '../lib/document-session';
import { ShareDialog } from '../ui/ShareDialog';
import styles from '../ui/common.module.scss';
import shellStyles from './shell.module.scss';

// 用字标而不是 emoji：emoji 在不同系统字形差异大，也最容易被看出「AI 生成感」
const TYPE_ICON: Record<DocumentType, string> = {
  mindmap: '板',
  markdown: 'MD',
  word: 'W',
  excel: 'X',
  ppt: 'P',
};

interface DocumentShellProps {
  document: ApiDocument | null;
  shareMode: 'view' | 'edit' | null;
  canWrite: boolean;
  syncStatus: SyncStatus;
  onRename?: (title: string) => Promise<void>;
  /** 每种编辑器自己的工具栏/导出按钮，渲染在标题右侧 */
  toolbar?: ReactNode;
  children: ReactNode;
}

export function DocumentShell({
  document,
  shareMode,
  canWrite,
  syncStatus,
  onRename,
  toolbar,
  children,
}: DocumentShellProps) {
  const [title, setTitle] = useState(document?.title ?? '');
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    setTitle(document?.title ?? '');
  }, [document?.title]);

  const commitTitle = () => {
    const next = title.trim();
    if (!onRename || !next || next === document?.title) {
      setTitle(document?.title ?? '');
      return;
    }
    void onRename(next);
  };

  let statusText = '已同步';
  let statusClass = shellStyles.dotSaved;
  switch (syncStatus.status) {
    case 'dirty':
      statusText = '待保存…';
      statusClass = shellStyles.dotBusy;
      break;
    case 'saving':
      statusText = '保存中…';
      statusClass = shellStyles.dotBusy;
      break;
    case 'saved':
      statusText = '已保存';
      statusClass = shellStyles.dotSaved;
      break;
    case 'readonly':
      statusText = '只读';
      statusClass = shellStyles.dot;
      break;
    case 'error':
      statusText = syncStatus.message;
      statusClass = shellStyles.dotError;
      break;
    case 'conflict':
      statusText = syncStatus.message;
      statusClass = shellStyles.dotError;
      break;
    default:
      break;
  }

  return (
    <div className={shellStyles.shell}>
      <div className={shellStyles.bar}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonGhost}`}
          onClick={() => navigate('/documents')}
        >
          ← 返回
        </button>
        {document ? <span className={shellStyles.icon}>{TYPE_ICON[document.type]}</span> : null}
        <input
          className={shellStyles.titleInput}
          value={title}
          disabled={!canWrite || !onRename}
          placeholder="未命名文档"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
        />
        {shareMode ? (
          <span className={styles.tag}>{shareMode === 'edit' ? '可编辑分享' : '只读分享'}</span>
        ) : null}
        <span className={shellStyles.status}>
          <span className={`${shellStyles.dot} ${statusClass}`} />
          {statusText}
        </span>
        <span className={styles.grow} />
        {toolbar}
        {document && canWrite && (document.myRole === 'owner' || !document.myRole) ? (
          <button type="button" className={styles.button} onClick={() => setShareOpen(true)}>
            分享
          </button>
        ) : null}
      </div>
      <div className={shellStyles.body}>{children}</div>

      {document && shareOpen ? (
        <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} document={document} />
      ) : null}
    </div>
  );
}
