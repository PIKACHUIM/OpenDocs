import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  documentApi,
  emptyContentFor,
  type ApiDocument,
  type DocumentType,
} from '../api';
import { navigate } from '../lib/router';
import { useAuth } from '../lib/auth';
import { Dropdown, DropdownItem } from '../ui/Dropdown';
import { Modal } from '../ui/Modal';
import { ShareDialog } from '../ui/ShareDialog';
import { TopBar, VerifyEmailBanner } from '../ui/TopBar';
import styles from '../ui/common.module.scss';

const PAGE_SIZE = 24;

const TYPE_META: Record<DocumentType, { label: string; icon: string }> = {
  mindmap: { label: '思维导图', icon: '🧠' },
  markdown: { label: 'Markdown', icon: '📝' },
  word: { label: 'Word 文档', icon: '📄' },
  excel: { label: 'Excel 表格', icon: '📊' },
  ppt: { label: '演示文稿', icon: '📽️' },
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  return date.toLocaleDateString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

type Scope = 'owned' | 'shared' | 'trash';

export function DocumentsPage() {
  const { user, loading: authLoading } = useAuth();
  const [scope, setScope] = useState<Scope>('owned');
  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<ApiDocument | null>(null);
  const [renameTarget, setRenameTarget] = useState<ApiDocument | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const load = useCallback(
    async (nextPage = 1) => {
      setLoading(true);
      setError(null);
      try {
        const data =
          scope === 'owned'
            ? await documentApi.list({ scope: 'owned', page: nextPage, pageSize: PAGE_SIZE, q: query })
            : scope === 'shared'
              ? await documentApi.list({ scope: 'shared', page: nextPage, pageSize: PAGE_SIZE, q: query })
              : await documentApi.list({
                  scope: 'owned',
                  page: nextPage,
                  pageSize: PAGE_SIZE,
                  q: query,
                  trashed: true,
                });
        setDocuments(data.documents);
        setTotal(data.total);
        setPage(data.page);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [scope, query]
  );

  useEffect(() => {
    if (!authLoading && user) void load(1);
  }, [authLoading, user, load]);

  if (!authLoading && !user) {
    navigate('/login', { replace: true });
    return null;
  }

  const createDocument = async (type: DocumentType) => {
    setBusy(true);
    setError(null);
    try {
      const data = await documentApi.create({
        type,
        title: `未命名${TYPE_META[type].label}`,
        content: emptyContentFor(type),
      });
      navigate(`/d/${data.document.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '创建失败');
      setBusy(false);
    }
  };

  const duplicate = async (document: ApiDocument) => {
    setBusy(true);
    try {
      await documentApi.duplicate(document.id);
      await load(page);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '复制失败');
    } finally {
      setBusy(false);
    }
  };

  const moveToTrash = async (document: ApiDocument) => {
    if (!window.confirm(`将「${document.title}」移入回收站？`)) return;
    setBusy(true);
    try {
      await documentApi.remove(document.id);
      await load(page);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (document: ApiDocument) => {
    setBusy(true);
    try {
      await documentApi.restore(document.id);
      await load(page);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '恢复失败');
    } finally {
      setBusy(false);
    }
  };

  const permanentDelete = async (document: ApiDocument) => {
    if (!window.confirm(`永久删除「${document.title}」？该操作不可恢复。`)) return;
    setBusy(true);
    try {
      await documentApi.remove(document.id, true);
      await load(page);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    setBusy(true);
    try {
      await documentApi.rename(renameTarget.id, renameValue);
      setRenameTarget(null);
      await load(page);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '重命名失败');
    } finally {
      setBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={styles.page}>
      <TopBar />
      <VerifyEmailBanner />
      <div className={styles.content}>
        <div className={styles.sectionHeader}>
          <h1>我的文档</h1>
          <Dropdown
            trigger={
              <span className={`${styles.button} ${styles.buttonPrimary}`}>+ 新建文档</span>
            }
          >
            {(Object.keys(TYPE_META) as DocumentType[]).map((type) => (
              <DropdownItem key={type} onClick={() => createDocument(type)}>
                {TYPE_META[type].icon} {TYPE_META[type].label}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${scope === 'owned' ? styles.tabActive : ''}`}
            onClick={() => setScope('owned')}
          >
            我的文档
          </button>
          <button
            type="button"
            className={`${styles.tab} ${scope === 'shared' ? styles.tabActive : ''}`}
            onClick={() => setScope('shared')}
          >
            与我共享
          </button>
          <button
            type="button"
            className={`${styles.tab} ${scope === 'trash' ? styles.tabActive : ''}`}
            onClick={() => setScope('trash')}
          >
            回收站
          </button>
        </div>

        <div className={styles.row} style={{ marginBottom: 16 }}>
          <input
            className={styles.input}
            placeholder="搜索标题…"
            style={{ maxWidth: 280 }}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load(1);
            }}
          />
          <button type="button" className={styles.button} onClick={() => load(1)}>
            搜索
          </button>
          <span className={styles.grow} />
          <span className={styles.hint}>共 {total} 个</span>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        {loading ? (
          <div className={styles.center}>加载中…</div>
        ) : documents.length === 0 ? (
          <div className={styles.empty}>
            {scope === 'trash' ? '回收站是空的' : scope === 'shared' ? '还没有人与你共享文档' : '还没有文档，点击上方「新建文档」开始吧'}
          </div>
        ) : (
          <div className={styles.grid}>
            {documents.map((document) => (
              <div
                key={document.id}
                className={styles.card}
                onClick={() => {
                  if (scope !== 'trash') navigate(`/d/${document.id}`);
                }}
              >
                <div className={styles.cardMenu} onClick={(event) => event.stopPropagation()}>
                  <Dropdown trigger={<span style={{ cursor: 'pointer', padding: '2px 6px' }}>⋯</span>}>
                    {scope === 'trash' ? (
                      <>
                        <DropdownItem onClick={() => restore(document)}>恢复</DropdownItem>
                        <DropdownItem onClick={() => permanentDelete(document)} danger>
                          永久删除
                        </DropdownItem>
                      </>
                    ) : (
                      <>
                        <DropdownItem
                          onClick={() => {
                            setRenameTarget(document);
                            setRenameValue(document.title);
                          }}
                        >
                          重命名
                        </DropdownItem>
                        <DropdownItem onClick={() => duplicate(document)}>创建副本</DropdownItem>
                        {document.myRole === 'owner' || !document.myRole ? (
                          <DropdownItem onClick={() => setShareTarget(document)}>分享</DropdownItem>
                        ) : null}
                        {document.myRole === 'owner' || !document.myRole ? (
                          <DropdownItem onClick={() => moveToTrash(document)} danger>
                            删除
                          </DropdownItem>
                        ) : null}
                      </>
                    )}
                  </Dropdown>
                </div>
                <div className={styles.cardIcon}>{TYPE_META[document.type].icon}</div>
                <div className={styles.cardTitle}>{document.title}</div>
                <div className={styles.cardMeta}>
                  {formatTime(document.updatedAt)} · {formatSize(document.sizeBytes)}
                  {document.linkShared ? (
                    <>
                      {' · '}
                      <span className={styles.tagSuccess}>
                        {document.linkMode === 'edit' ? '可编辑分享' : '只读分享'}
                      </span>
                    </>
                  ) : null}
                  {document.myRole && document.myRole !== 'owner' ? (
                    <>
                      {' · '}
                      <span className={styles.tagMuted}>{document.myRole === 'editor' ? '协作编辑' : '协作只读'}</span>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 ? (
          <div className={styles.pagination}>
            <button className={styles.button} disabled={page <= 1 || busy} onClick={() => load(page - 1)}>
              上一页
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button className={styles.button} disabled={page >= totalPages || busy} onClick={() => load(page + 1)}>
              下一页
            </button>
          </div>
        ) : null}
      </div>

      {shareTarget ? (
        <ShareDialog
          open
          onClose={() => setShareTarget(null)}
          document={shareTarget}
          onChanged={(updated) => {
            setDocuments((list) => list.map((item) => (item.id === updated.id ? updated : item)));
          }}
        />
      ) : null}

      <Modal
        open={!!renameTarget}
        title="重命名文档"
        onClose={() => setRenameTarget(null)}
        footer={
          <>
            <button className={styles.button} onClick={() => setRenameTarget(null)}>
              取消
            </button>
            <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={submitRename} disabled={busy}>
              保存
            </button>
          </>
        }
      >
        <input
          className={styles.input}
          value={renameValue}
          maxLength={120}
          onChange={(event) => setRenameValue(event.target.value)}
          autoFocus
        />
      </Modal>
    </div>
  );
}
