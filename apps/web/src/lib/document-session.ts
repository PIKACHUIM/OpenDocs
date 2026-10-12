import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  documentApi,
  shareApi,
  type ApiDocument,
  type DocumentAccess,
  type DocumentContent,
  type LinkShareMode,
} from '../api';

const SAVE_DEBOUNCE_MS = 1500;

export type SyncStatus =
  | { status: 'idle' }
  | { status: 'dirty' }
  | { status: 'saving' }
  | { status: 'saved'; savedAt: string }
  | { status: 'readonly' }
  | { status: 'error'; message: string }
  | { status: 'conflict'; message: string };

export interface DocumentSession {
  kind: 'document' | 'share';
  id: string;
  document: ApiDocument | null;
  content: DocumentContent | null;
  access: DocumentAccess;
  shareMode: LinkShareMode | null;
  loading: boolean;
  error: string | null;
  syncStatus: SyncStatus;
  canWrite: boolean;
  scheduleSave: (content: DocumentContent) => void;
  saveNow: (content: DocumentContent) => Promise<void>;
  renameNow: (title: string) => Promise<void>;
}

/**
 * 统一的文档加载 + 乐观锁保存 + 防抖自动保存。
 * 五个编辑器都用这同一个 hook，只是各自渲染/编辑 content 的方式不同。
 */
export function useDocumentSession(kind: 'document' | 'share', id: string): DocumentSession {
  const [document, setDocument] = useState<ApiDocument | null>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [access, setAccess] = useState<DocumentAccess>('none');
  const [shareMode, setShareMode] = useState<LinkShareMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ status: 'idle' });

  const versionRef = useRef(1);
  const accessRef = useRef<DocumentAccess>('none');
  const pendingRef = useRef<DocumentContent | null>(null);
  const inflightRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

    const loader =
      kind === 'document'
        ? documentApi.get(id).then((data) => ({
            document: data.document,
            content: data.content,
            access: data.access,
            mode: null as LinkShareMode | null,
          }))
        : shareApi.get(id).then((data) => ({
            document: data.document,
            content: data.content,
            access: data.access,
            mode: data.mode,
          }));

    loader
      .then((data) => {
        if (cancelled) return;
        versionRef.current = data.document.version;
        accessRef.current = data.access;
        setDocument(data.document);
        setContent(data.content);
        setAccess(data.access);
        setShareMode(data.mode);
        setSyncStatus(data.access === 'owner' || data.access === 'editor' ? { status: 'idle' } : { status: 'readonly' });
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : '文档加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  const runSave = useCallback(
    async (nextContent: DocumentContent) => {
      if (accessRef.current !== 'owner' && accessRef.current !== 'editor') return;
      pendingRef.current = nextContent;
      if (inflightRef.current) return;

      inflightRef.current = true;
      try {
        while (pendingRef.current) {
          const snapshot = pendingRef.current;
          pendingRef.current = null;
          setSyncStatus({ status: 'saving' });
          try {
            const result =
              kind === 'document'
                ? await documentApi.save(id, { content: snapshot, baseVersion: versionRef.current })
                : await shareApi.save(id, { content: snapshot, baseVersion: versionRef.current });
            versionRef.current = result.document.version;
            setDocument(result.document);
            setSyncStatus({ status: 'saved', savedAt: new Date().toISOString() });
          } catch (caught) {
            if (caught instanceof ApiError && caught.isConflict) {
              setSyncStatus({ status: 'conflict', message: '文档已在其它设备被修改，请刷新后再保存' });
            } else {
              setSyncStatus({
                status: 'error',
                message: caught instanceof Error ? caught.message : '保存失败',
              });
            }
            pendingRef.current = null;
            break;
          }
        }
      } finally {
        inflightRef.current = false;
      }
    },
    [kind, id]
  );

  const scheduleSave = useCallback(
    (nextContent: DocumentContent) => {
      if (accessRef.current !== 'owner' && accessRef.current !== 'editor') return;
      setContent(nextContent);
      setSyncStatus((previous) => (previous.status === 'saving' ? previous : { status: 'dirty' }));
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void runSave(nextContent);
      }, SAVE_DEBOUNCE_MS);
    },
    [runSave]
  );

  const saveNow = useCallback(
    async (nextContent: DocumentContent) => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setContent(nextContent);
      await runSave(nextContent);
    },
    [runSave]
  );

  const renameNow = useCallback(
    async (title: string) => {
      if (kind !== 'document' || accessRef.current === 'none') return;
      const result = await documentApi.rename(id, title);
      setDocument(result.document);
    },
    [kind, id]
  );

  // 页面隐藏/关闭时用 keepalive 补发还没来得及发出的变更
  useEffect(() => {
    const flush = () => {
      const pending = pendingRef.current;
      if (!pending) return;
      if (accessRef.current !== 'owner' && accessRef.current !== 'editor') return;
      const url = kind === 'document' ? `/api/documents/${id}` : `/api/share/${id}`;
      try {
        void fetch(url, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          keepalive: true,
          body: JSON.stringify({ content: pending, baseVersion: versionRef.current }),
        });
        pendingRef.current = null;
      } catch {
        // 卸载阶段失败无法反馈给用户，忽略
      }
    };
    const onVisibility = () => {
      // 注意：这里不能写成 `document.visibilityState`——本文件里 `document` 已被
      // useState 变量名遮蔽（指向 ApiDocument | null），必须显式走 window.document
      if (window.document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    window.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.document.removeEventListener('visibilitychange', onVisibility);
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [kind, id]);

  return {
    kind,
    id,
    document,
    content,
    access,
    shareMode,
    loading,
    error,
    syncStatus,
    canWrite: access === 'owner' || access === 'editor',
    scheduleSave,
    saveNow,
    renameNow,
  };
}
