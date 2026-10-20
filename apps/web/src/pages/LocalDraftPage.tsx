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
import { Dropdown, DropdownItem } from '../ui/Dropdown';
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
 * 草稿是否已有实际内容。
 * 用于「离开前提醒」——空文档不必打扰用户，有内容才拦截。
 */
function draftHasContent(type: TryType, content: DocumentContent): boolean {
  switch (type) {
    case 'markdown':
      return ((content as MarkdownContent).markdown ?? '').trim().length > 0;
    case 'mindmap':
      return ((content as MindmapContent).elements ?? []).length > 0;
    case 'excel': {
      const excel = content as ExcelContent;
      if (excel.univer) return true;
      return (excel.sheets ?? []).some((sheet) => (sheet.celldata ?? []).length > 0);
    }
    case 'ppt': {
      const ppt = content as PptContent;
      return (ppt.slides ?? []).some((slide) => (slide.elements ?? []).length > 0);
    }
    case 'word': {
      const word = content as WordContent;
      if (word.univer) return true;
      const nodes = (word.doc as { content?: unknown[] } | undefined)?.content ?? [];
      return nodes.length > 1;
    }
    default:
      return false;
  }
}

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
  const [exporting, setExporting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storageKey = `draft:${type}`;

  const hasContent = useMemo(
    () => (content ? draftHasContent(type, content) : false),
    [content, type]
  );

  // 关闭标签页 / 刷新时提醒：内容只在本地，误关就找不回来了
  useEffect(() => {
    if (!hasContent) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasContent]);

  /**
   * 返回：回首页而不是丢给登录页。
   * 有内容时先确认，避免误触把正在编辑的草稿丢掉。
   */
  const handleBack = useCallback(() => {
    if (
      hasContent &&
      !window.confirm(
        '当前内容只保存在这台设备上，离开后仍可回来继续编辑。\n\n确定要离开吗？'
      )
    ) {
      return;
    }
    navigate('/');
  }, [hasContent]);

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

  /**
   * 试用页也能导出：本地草稿本身就在浏览器里，
   * 导出逻辑与云端文档完全一致，只是不需要了服务端。
   */
  const runExport = async (task: () => Promise<void> | void) => {
    setExporting(true);
    try {
      await task();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const exportItems: Array<{ label: string; onSelect: () => void }> =
    type === 'mindmap'
      ? [
          {
            label: '导出为 .drawnix',
            onSelect: () =>
              runExport(async () => {
                const { exportMindmapJson } = await import('../export/mindmapExport');
                exportMindmapJson(content as MindmapContent, title);
              }),
          },
        ]
      : type === 'markdown'
        ? [
            {
              label: '导出 Markdown 源码',
              onSelect: () =>
                runExport(async () => {
                  const { exportMarkdownSource } = await import('../export/markdownExport');
                  exportMarkdownSource(content as MarkdownContent, title);
                }),
            },
          ]
        : type === 'word'
          ? [
              {
                label: '导出为 Word (.docx)',
                onSelect: () =>
                  runExport(async () => {
                    const { exportWordToDocx } = await import('../export/wordExport');
                    await exportWordToDocx(content as WordContent, title);
                  }),
              },
            ]
          : type === 'excel'
            ? [
                {
                  label: '导出为 Excel (.xlsx)',
                  onSelect: () =>
                    runExport(async () => {
                      const { exportExcelToXlsx } = await import('../export/excelExport');
                      await exportExcelToXlsx(content as ExcelContent, title);
                    }),
                },
              ]
            : [
                {
                  label: '导出为 PowerPoint (.pptx)',
                  onSelect: () =>
                    runExport(async () => {
                      const { exportPptToPptx } = await import('../export/pptExport');
                      await exportPptToPptx(content as PptContent, title);
                    }),
                },
              ];

  const shared = { canWrite: true, documentId: null, shareToken: null };

  return (
    <DocumentShell
      document={shellDocument}
      shareMode={null}
      canWrite
      syncStatus={status}
      onRename={handleRename}
      onBack={handleBack}
      toolbar={
        <div className={styles.row}>
          <span className={`${styles.tag} ${styles.tagMuted}`}>免登录 · 仅存本地</span>
          <Dropdown
            trigger={<span className={styles.button}>{exporting ? '导出中…' : '导出'}</span>}
            align="left"
          >
            {exportItems.map((item) => (
              <DropdownItem key={item.label} onClick={item.onSelect}>
                {item.label}
              </DropdownItem>
            ))}
          </Dropdown>
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
