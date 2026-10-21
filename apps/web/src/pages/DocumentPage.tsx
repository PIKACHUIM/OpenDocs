import { alertDialog, confirmDialog } from '../ui/dialog';
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { DocumentContent, ExcelContent, MarkdownContent, MindmapContent, PptContent, WordContent } from '../api';
import { DocumentShell } from '../editors/DocumentShell';
import { useDocumentSession } from '../lib/document-session';
import { navigate } from '../lib/router';
import { Dropdown, DropdownItem } from '../ui/Dropdown';
import styles from '../ui/common.module.scss';

/**
 * 五个编辑器各自依赖的重型库（Tiptap / Fortune Sheet 等）完全不小，
 * 全部懒加载：打开本地白板或某一种文档类型时，只下载真正用到的那一份代码，
 * 而不是把全部编辑器打进一个首屏 bundle。
 */
const MindmapEditor = lazy(() => import('../editors/mindmap/MindmapEditor').then((m) => ({ default: m.MindmapEditor })));
const MarkdownEditor = lazy(() => import('../editors/markdown/MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })));
const WordEditor = lazy(() => import('../editors/word/WordEditorEntry').then((m) => ({ default: m.WordEditor })));
const ExcelEditor = lazy(() => import('../editors/excel/ExcelEditor').then((m) => ({ default: m.ExcelEditor })));
const PptEditor = lazy(() => import('../editors/ppt/PptEditor').then((m) => ({ default: m.PptEditor })));

interface DocumentPageProps {
  kind: 'document' | 'share';
  id: string;
}

export function DocumentPage({ kind, id }: DocumentPageProps) {
  const session = useDocumentSession(kind, id);
  const [exporting, setExporting] = useState(false);

  // 有未同步的改动时，关闭标签页/刷新前提醒一次
  const unsaved =
    session.syncStatus.status === 'dirty' || session.syncStatus.status === 'saving';

  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  const handleBack = useCallback(async () => {
    if (unsaved) {
      const ok = await confirmDialog('还有改动没有保存到云端，确定离开吗？', {
        danger: true,
        title: '离开当前文档',
        confirmText: '离开',
      });
      if (!ok) return;
    }
    navigate(kind === 'share' ? '/' : '/documents');
  }, [unsaved, kind]);

  const editorContext = useMemo(
    () => ({
      documentId: kind === 'document' ? id : null,
      shareToken: kind === 'share' ? id : null,
    }),
    [kind, id]
  );

  if (session.loading) {
    return <div className={styles.center} style={{ position: 'fixed', inset: 0 }}>加载中…</div>;
  }
  if (session.error || !session.document || !session.content) {
    return (
      <div className={styles.center} style={{ position: 'fixed', inset: 0, flexDirection: 'column', gap: 12 }}>
        <div>{session.error ?? '文档不存在或已被删除'}</div>
      </div>
    );
  }

  const { document, content, canWrite } = session;
  const title = document.title;

  // 浏览模式：显式 ?mode=view，或当前用户没有编辑权限时自动进入
  const forcedView = new URLSearchParams(window.location.search).get('mode') === 'view';
  const readOnly = forcedView || !canWrite;

  // 图片文档有自己的画布布局（无 DocumentShell），统一跳到图片编辑页的云端模式
  if (document.type === 'image' && kind === 'document') {
    navigate(`/image?id=${document.id}${readOnly ? '&mode=view' : ''}`);
    return <div className={styles.center}>正在打开图片编辑器…</div>;
  }

  const runExport = async (task: () => Promise<void> | void) => {
    setExporting(true);
    try {
      await task();
    } catch (error) {
      void alertDialog(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  // 导出用到的 docx / exceljs / pptxgenjs / jspdf 等库同样按需动态 import，
  // 不点击「导出」就完全不会被加载。
  const exportItems: Array<{ label: string; onSelect: () => void }> =
    document.type === 'mindmap'
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
      : document.type === 'markdown'
        ? [
            {
              label: '导出 Markdown 源码',
              onSelect: () =>
                runExport(async () => {
                  const { exportMarkdownSource } = await import('../export/markdownExport');
                  exportMarkdownSource(content as MarkdownContent, title);
                }),
            },
            {
              label: '生成 PDF',
              onSelect: () =>
                runExport(async () => {
                  const { exportMarkdownToPdf } = await import('../export/markdownExport');
                  await exportMarkdownToPdf(title);
                }),
            },
          ]
        : document.type === 'word'
          ? [
              {
                label: '导出为 Word (.docx)',
                onSelect: () =>
                  runExport(async () => {
                    const { exportWordToDocx } = await import('../export/wordExport');
                    await exportWordToDocx(content as WordContent, title);
                  }),
              },
              {
                label: '生成 PDF',
                onSelect: () =>
                  runExport(async () => {
                    const { exportWordToPdf } = await import('../export/wordExport');
                    await exportWordToPdf(title);
                  }),
              },
            ]
          : document.type === 'excel'
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

  const shared = {
    // 浏览模式下所有编辑器一律只读
    canWrite: !readOnly,
    documentId: editorContext.documentId,
    shareToken: editorContext.shareToken,
  };

  return (
    <DocumentShell
      document={document}
      shareMode={session.shareMode}
      canWrite={!readOnly}
      syncStatus={session.syncStatus}
      onRename={kind === 'document' ? session.renameNow : undefined}
      onBack={handleBack}
      toolbar={
        <>
          {readOnly ? (
            <span className={`${styles.tag} ${styles.tagMuted}`} title="浏览模式下无法编辑内容">
              浏览模式
            </span>
          ) : null}
          <Dropdown trigger={<span className={styles.button}>{exporting ? '导出中…' : '导出'}</span>} align="left">
            {exportItems.map((item) => (
              <DropdownItem key={item.label} onClick={item.onSelect}>
                {item.label}
              </DropdownItem>
            ))}
          </Dropdown>
        </>
      }
    >
      <Suspense fallback={<div className={styles.center} style={{ position: 'absolute', inset: 0 }}>加载编辑器…</div>}>
        {document.type === 'mindmap' ? (
          <MindmapEditor {...shared} content={content as MindmapContent} onChange={(next) => session.scheduleSave(next)} />
        ) : document.type === 'markdown' ? (
          <MarkdownEditor {...shared} content={content as MarkdownContent} onChange={(next) => session.scheduleSave(next)} />
        ) : document.type === 'word' ? (
          <WordEditor {...shared} content={content as WordContent} onChange={(next) => session.scheduleSave(next)} />
        ) : document.type === 'excel' ? (
          <ExcelEditor {...shared} content={content as ExcelContent} onChange={(next) => session.scheduleSave(next)} />
        ) : (
          <PptEditor {...shared} content={content as PptContent} onChange={(next) => session.scheduleSave(next)} />
        )}
      </Suspense>
    </DocumentShell>
  );
}

export type { DocumentContent };
