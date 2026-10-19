import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import localforage from 'localforage';
import {
  ApiError,
  documentApi,
  emptyContentFor,
  type ApiDocument,
  type DocumentContent,
  type ExcelContent,
  type MarkdownContent,
  type MindmapContent,
  type PptContent,
  type WordContent,
} from '../api';
import { DocumentShell } from '../editors/DocumentShell';
import { useAuth } from '../lib/auth';
import { navigate, type TryType } from '../lib/router';
import type { SyncStatus } from '../lib/document-session';
import styles from '../ui/common.module.scss';

const MindmapEditor = lazy(() =>
  import('../editors/mindmap/MindmapEditor').then((m) => ({ default: m.MindmapEditor }))
);
const MarkdownEditor = lazy(() =>
  import('../editors/markdown/MarkdownEditor').then((m) => ({ default: m.MarkdownEditor }))
);
const WordEditor = lazy(() =>
  import('../editors/word/WordEditorEntry').then((m) => ({ default: m.WordEditor }))
);
const ExcelEditor = lazy(() =>
  import('../editors/excel/ExcelEditor').then((m) => ({ default: m.ExcelEditor }))
);
const PptEditor = lazy(() => import('../editors/ppt/PptEditor').then((m) => ({ default: m.PptEditor })));

const TYPE_TITLE: Record<TryType, string> = {
  mindmap: '未命名白板',
  markdown: '未命名 Markdown',
  word: '未命名文档',
  excel: '未命名表格',
  ppt: '未命名演示',
};

const SAVE_DEBOUNCE_MS = 600;

/**
 * 免登录试用页。
 *
 * 与云端文档页的区别只有一个：数据落在浏览器本地（localforage），
 * 不产生任何网络请求。登录后可一键「保存到我的文档」，转成真正的云端文档。
 * 这样「本地编辑」与「云端文档」共用同一套编辑器，不再有两条割裂的链路。
 */
export function LocalDraftPage({ type }: { type: TryType }) {
  const { user } = useAuth();
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [title, setTitle] = useState(TYPE_TITLE[type]);
  const [status, setStatus] = useState<SyncStatus>({ status: 'idle' });
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storageKey = `draft:${type}`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = (await localforage.getItem<{ title?: string; content?: DocumentContent }>(
        storageKey
      )) ?? null;
      if (cancelled) return;
      setContent(stored?.content ?? (emptyContentFor(type) as DocumentContent));
      if (stored?.title) setTitle(stored.title);
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey, type]);

  const persist = useCallback(
    (next: DocumentContent, nextTitle: string) => {
      if (timer.current) clearTimeout(timer.current);
      setStatus({ status: 'dirty' });
      timer.current = setTimeout(() => {
        setStatus({ status: 'saving' });
        void localforage
          .setItem(storageKey, { title: nextTitle, content: next })
          .then(() => setStatus({ status: 'saved', savedAt: new Date().toISOString() }))
          .catch(() => setStatus({ status: 'error', message: '本地保存失败' }));
      }, SAVE_DEBOUNCE_MS);
    },
    [storageKey]
  );

  const handleChange = (next: DocumentContent) => {
    setContent(next);
    persist(next, title);
  };

  const handleRename = async (nextTitle: string) => {
    setTitle(nextTitle);
    if (content) persist(content, nextTitle);
  };

  const saveToAccount = async () => {
    if (!content) return;
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/try/${type}`)}`);
      return;
    }
    setSaving(true);
    try {
      const data = await documentApi.create({ type, title, content });
      // 云端已接管，清掉本地草稿，避免下次进来看到旧内容
      await localforage.removeItem(storageKey);
      navigate(`/d/${data.document.id}`);
    } catch (error) {
      window.alert(error instanceof ApiError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // DocumentShell 需要一份「文档」，这里用合成对象，id 不代表真实云端记录
  const shellDocument = useMemo<ApiDocument>(() => {
    const now = new Date().toISOString();
    return {
      id: 'local-draft',
      type,
      title,
      ownerId: user?.id ?? 'local',
      ownerName: user?.displayName ?? null,
      sizeBytes: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      linkShared: false,
      linkMode: null,
      folderId: null,
      starred: false,
      lastOpenedAt: null,
      myRole: 'owner',
    };
  }, [type, title, user]);

  if (!content) {
    return <div className={styles.center}>加载中…</div>;
  }

  const shared = { canWrite: true, documentId: null, shareToken: null };

  return (
    <DocumentShell
      document={shellDocument}
      shareMode={null}
      canWrite
      syncStatus={status}
      onRename={handleRename}
      toolbar={
        <div className={styles.row}>
          <span className={`${styles.tag} ${styles.tagMuted}`}>免登录 · 仅存本地</span>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={saving}
            onClick={saveToAccount}
          >
            {saving ? '保存中…' : user ? '保存到我的文档' : '登录并保存'}
          </button>
        </div>
      }
    >
      <Suspense
        fallback={
          <div className={styles.center} style={{ position: 'absolute', inset: 0 }}>
            加载编辑器…
          </div>
        }
      >
        {type === 'mindmap' ? (
          <MindmapEditor
            {...shared}
            content={content as MindmapContent}
            onChange={handleChange}
          />
        ) : type === 'markdown' ? (
          <MarkdownEditor
            {...shared}
            content={content as MarkdownContent}
            onChange={handleChange}
          />
        ) : type === 'word' ? (
          <WordEditor {...shared} content={content as WordContent} onChange={handleChange} />
        ) : type === 'excel' ? (
          <ExcelEditor {...shared} content={content as ExcelContent} onChange={handleChange} />
        ) : (
          <PptEditor {...shared} content={content as PptContent} onChange={handleChange} />
        )}
      </Suspense>
    </DocumentShell>
  );
}
