import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  documentApi,
  folderApi,
  teamApi,
  type ApiDocument,
  type ApiFolder,
  type ApiTeam,
  type DocumentContent,
  type DocumentType,
} from '../api';
import { navigate } from '../lib/router';
import { useAuth } from '../lib/auth';
import { Dropdown, DropdownItem } from '../ui/Dropdown';
import { Modal } from '../ui/Modal';
import { NewDocumentDialog } from '../ui/NewDocumentDialog';
import { ShareDialog } from '../ui/ShareDialog';
import { TopBar, VerifyEmailBanner } from '../ui/TopBar';
import styles from '../ui/common.module.scss';

const PAGE_SIZE = 30;
const VIEW_KEY = 'opendocs:docs-view';

/**
 * 文档类型元信息。
 * 图标用「字标 + 低饱和底色」而不是 emoji：emoji 在不同系统上字形差异大，
 * 且是「AI 生成感」最明显的特征之一。
 */
const TYPE_META: Record<DocumentType, { label: string; badge: string; fg: string; bg: string }> = {
  mindmap: { label: '白板 / 思维导图', badge: '板', fg: '#3370ff', bg: '#eef3ff' },
  markdown: { label: 'Markdown', badge: 'MD', fg: '#6f4bd8', bg: '#f3efff' },
  word: { label: 'Word 文档', badge: 'W', fg: '#1a56c4', bg: '#eaf1fe' },
  excel: { label: 'Excel 表格', badge: 'X', fg: '#0f7b45', bg: '#e9f7ef' },
  ppt: { label: '演示文稿', badge: 'P', fg: '#c2500f', bg: '#fdf0e8' },
  image: { label: '图片', badge: '图', fg: '#b5487a', bg: '#fdeff5' },
};

type Scope = 'recent' | 'owned' | 'shared' | 'sent' | 'starred' | 'trash';
type View = 'list' | 'card';

const SCOPE_LABEL: Record<Scope, string> = {
  recent: '最近使用',
  owned: '我的文档',
  shared: '与我共享',
  sent: '我的分享',
  starred: '收藏文档',
  trash: '最近删除',
};

/** 分区 tab 的顺序 */
const SCOPE_ORDER: Array<{ key: Scope; label: string }> = [
  { key: 'recent', label: '最近' },
  { key: 'owned', label: '我的文档' },
  { key: 'shared', label: '与我共享' },
  { key: 'sent', label: '我的分享' },
  { key: 'starred', label: '收藏文档' },
  { key: 'trash', label: '最近删除' },
];

/** 右键菜单的目标：文档或目录 */
type ContextTarget =
  | { kind: 'document'; doc: ApiDocument; x: number; y: number }
  | { kind: 'folder'; folder: ApiFolder; x: number; y: number };

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

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function DocIcon({ type }: { type: DocumentType }) {
  const meta = TYPE_META[type];
  return (
    <span className={styles.docIcon} style={{ color: meta.fg, background: meta.bg }}>
      {meta.badge}
    </span>
  );
}

export function DocumentsPage() {
  const { user, loading: authLoading } = useAuth();

  const [scope, setScope] = useState<Scope>('owned');
  /** null 表示「我的文档」全部；字符串表示正在浏览某个目录 */
  const [folderId, setFolderId] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(VIEW_KEY);
    return stored === 'card' ? 'card' : 'list';
  });

  const [folders, setFolders] = useState<ApiFolder[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  /** 我加入的团队空间；选中后列表只显示该空间的文档 */
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 「最近删除」的保留天数，由服务端下发 */
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextTarget | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  /** 选完类型后打开的新建弹窗（最近文档 + 模板） */
  const [newDocType, setNewDocType] = useState<DocumentType | null>(null);
  const [shareTarget, setShareTarget] = useState<ApiDocument | null>(null);
  const [renameTarget, setRenameTarget] = useState<ApiDocument | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [moveTarget, setMoveTarget] = useState<ApiDocument | null>(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderName, setFolderName] = useState('');

  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  const loadFolders = useCallback(async () => {
    try {
      const data = await folderApi.list();
      setFolders(data.folders);
    } catch {
      // 目录加载失败不影响文档列表
    }
  }, []);

  const loadTeams = useCallback(async () => {
    try {
      const data = await teamApi.list();
      setTeams(data.teams);
    } catch {
      // 团队加载失败不影响个人文档
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Parameters<typeof documentApi.list>[0] = {
        page,
        pageSize: PAGE_SIZE,
        q: query || undefined,
      };
      if (scope === 'shared') params.scope = 'shared';
      if (scope === 'sent') params.scope = 'sent';
      if (scope === 'trash') params.trashed = true;
      if (scope === 'starred') params.starred = true;
      if (scope === 'recent') params.recent = true;
      if (scope === 'owned' && folderId && !teamId) params.folderId = folderId;
    if (teamId) params.teamId = teamId;

      const data = await documentApi.list(params);
      setDocuments(data.documents);
      setTotal(data.total);
      setRetentionDays(data.retentionDays ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [scope, folderId, page, query, teamId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login?redirect=%2Fdocuments');
      return;
    }
    void load();
    void loadFolders();
  }, [authLoading, user, load, loadFolders]);

  useEffect(() => {
    setPage(1);
  }, [scope, folderId, query]);

  const folderMap = useMemo(() => new Map(folders.map((item) => [item.id, item])), [folders]);

  const childFolders = useMemo(() => {
    const map = new Map<string | null, ApiFolder[]>();
    for (const folder of folders) {
      const list = map.get(folder.parentId) ?? [];
      list.push(folder);
      map.set(folder.parentId, list);
    }
    return map;
  }, [folders]);

  /** 从根到当前目录的路径，用于面包屑 */
  const breadcrumb = useMemo(() => {
    const trail: ApiFolder[] = [];
    let current = folderId ? folderMap.get(folderId) : null;
    const guard = new Set<string>();
    while (current && !guard.has(current.id)) {
      guard.add(current.id);
      trail.unshift(current);
      current = current.parentId ? folderMap.get(current.parentId) ?? null : null;
    }
    return trail;
  }, [folderId, folderMap]);

  const currentFolderName = folderId ? folderMap.get(folderId)?.name ?? '目录' : SCOPE_LABEL[scope];

  const createFolder = async () => {
    if (!folderName.trim()) return;
    setBusy(true);
    try {
      await folderApi.create({ name: folderName.trim(), parentId: folderId });
      setFolderName('');
      setFolderModalOpen(false);
      await loadFolders();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '创建目录失败');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 导入本地文件：
   * - .md / .markdown / .txt → Markdown 文档
   * - .drawnix / .json → 若是我们的内容结构直接用；若是白板导出的 children 列表则转成思维导图
   */
  const importFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      const title = file.name.replace(/\.[^.]+$/, '') || '导入的文档';
      let type: DocumentType = 'markdown';
      let content: DocumentContent = { type: 'markdown', version: 1, markdown: text, mindmaps: {} };

      if (/\.(md|markdown|txt)$/i.test(file.name)) {
        type = 'markdown';
        content = { type, version: 1, markdown: text, mindmaps: {} };
      } else {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (typeof parsed.type === 'string' && typeof parsed.version === 'number') {
          type = parsed.type as DocumentType;
          content = parsed as unknown as DocumentContent;
        } else if (Array.isArray(parsed.children)) {
          type = 'mindmap';
          content = {
            type,
            version: 1,
            elements: parsed.children,
            viewport: parsed.viewport ?? { zoom: 1 },
            theme: parsed.theme,
          } as unknown as DocumentContent;
        } else {
          throw new Error('无法识别的文件结构');
        }
      }

      const data = await documentApi.create({ type, title, content, folderId });
      navigate(`/d/${data.document.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : '导入失败：仅支持 .md / .txt / .drawnix / .json'
      );
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setBusy(true);
    try {
      await documentApi.update(renameTarget.id, { title: renameValue.trim() });
      setRenameTarget(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '重命名失败');
    } finally {
      setBusy(false);
    }
  };

  const moveTo = async (targetFolderId: string | null) => {
    if (!moveTarget) return;
    setBusy(true);
    try {
      await documentApi.update(moveTarget.id, { folderId: targetFolderId });
      setMoveTarget(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '移动失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleStar = async (doc: ApiDocument) => {
    setBusy(true);
    try {
      await documentApi.update(doc.id, { starred: !doc.starred });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const removeDocument = async (doc: ApiDocument, permanent = false) => {
    const message = permanent
      ? `永久删除「${doc.title}」？该操作不可恢复。`
      : `将「${doc.title}」移入回收站？`;
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      await documentApi.remove(doc.id, permanent);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const restoreDocument = async (doc: ApiDocument) => {
    setBusy(true);
    try {
      await documentApi.restore(doc.id);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '恢复失败');
    } finally {
      setBusy(false);
    }
  };

  const duplicateDocument = async (doc: ApiDocument) => {
    setBusy(true);
    try {
      await documentApi.duplicate(doc.id);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '创建副本失败');
    } finally {
      setBusy(false);
    }
  };

  const openDocument = (doc: ApiDocument) => navigate(`/d/${doc.id}`);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** 关闭右键菜单：点击任意处、滚动、ESC 都收起 */
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const openDocMenu = (event: React.MouseEvent, doc: ApiDocument) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind: 'document', doc, x: event.clientX, y: event.clientY });
  };

  const openFolderMenu = (event: React.MouseEvent, folder: ApiFolder) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind: 'folder', folder, x: event.clientX, y: event.clientY });
  };

  const renameFolder = async (folder: ApiFolder) => {
    setContextMenu(null);
    const next = window.prompt('重命名目录', folder.name);
    if (!next || !next.trim() || next.trim() === folder.name) return;
    setBusy(true);
    try {
      await folderApi.update(folder.id, { name: next.trim() });
      await loadFolders();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '重命名目录失败');
    } finally {
      setBusy(false);
    }
  };

  const removeFolder = async (folder: ApiFolder) => {
    setContextMenu(null);
    if (!window.confirm(`删除目录「${folder.name}」？其中的文档会移动到上级目录，不会被删除。`)) {
      return;
    }
    setBusy(true);
    try {
      await folderApi.remove(folder.id);
      if (folderId === folder.id) setFolderId(folder.parentId);
      await Promise.all([loadFolders(), load()]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '删除目录失败');
    } finally {
      setBusy(false);
    }
  };

  const renderRowMenu = (doc: ApiDocument) => (
    <Dropdown trigger={<span className={`${styles.button} ${styles.buttonGhost} ${styles.buttonSm}`}>⋯</span>}>
      {scope === 'trash' ? (
        <>
          <DropdownItem onClick={() => restoreDocument(doc)}>恢复</DropdownItem>
          <DropdownItem onClick={() => removeDocument(doc, true)}>永久删除</DropdownItem>
        </>
      ) : (
        <>
          {/* 与右键菜单保持同一组操作，避免两处行为不一致 */}
          <DropdownItem onClick={() => openDocument(doc)}>打开</DropdownItem>
          <DropdownItem
            onClick={() => {
              setRenameTarget(doc);
              setRenameValue(doc.title);
            }}
          >
            重命名
          </DropdownItem>
          <DropdownItem onClick={() => setMoveTarget(doc)}>移动到目录</DropdownItem>
          <DropdownItem onClick={() => toggleStar(doc)}>
            {doc.starred ? '取消收藏' : '收藏'}
          </DropdownItem>
          <DropdownItem onClick={() => setShareTarget(doc)}>分享</DropdownItem>
          <DropdownItem onClick={() => duplicateDocument(doc)}>创建副本</DropdownItem>
          <DropdownItem onClick={() => removeDocument(doc)}>移入回收站</DropdownItem>
        </>
      )}
    </Dropdown>
  );

  const locationLabel = (doc: ApiDocument) =>
    doc.folderId ? folderMap.get(doc.folderId)?.name ?? '目录' : '我的文档';

  const renderListItem = (doc: ApiDocument) => (
    <div
      key={doc.id}
      className={styles.listRow}
      onClick={() => openDocument(doc)}
      onContextMenu={(event) => openDocMenu(event, doc)}
    >
      <span className={styles.listNameCell}>
        <DocIcon type={doc.type} />
        <span className={styles.cardTitle} style={{ marginBottom: 0 }}>
          {doc.title}
        </span>
        {doc.starred ? <span className={`${styles.tag} ${styles.tagMuted}`}>已收藏</span> : null}
        {doc.linkShared ? <span className={`${styles.tag} ${styles.tagMuted}`}>已分享</span> : null}
      </span>
      <span>{doc.myRole === 'owner' || !doc.ownerName ? '我' : doc.ownerName}</span>
      <span>{locationLabel(doc)}</span>
      <span>{formatTime(doc.lastOpenedAt ?? doc.updatedAt)}</span>
      <span className={styles.listRowActions} onClick={(event) => event.stopPropagation()}>
        <span className={styles.listSize}>{formatSize(doc.sizeBytes)}</span>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonGhost} ${styles.buttonSm}`}
          title="在此位置新建文档"
          onClick={() => setCreateOpen(true)}
        >
          +
        </button>
        {renderRowMenu(doc)}
      </span>
    </div>
  );

  const renderCard = (doc: ApiDocument) => (
    <div
      key={doc.id}
      className={styles.card}
      onClick={() => openDocument(doc)}
      onContextMenu={(event) => openDocMenu(event, doc)}
    >
      <div className={styles.cardIcon}>
        <DocIcon type={doc.type} />
      </div>
      <div className={styles.cardTitle}>{doc.title}</div>
      <div className={styles.cardMeta}>
        {formatTime(doc.lastOpenedAt ?? doc.updatedAt)} · {formatSize(doc.sizeBytes)}
      </div>
      <div className={styles.cardMenu} onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonGhost} ${styles.buttonSm}`}
          title="在此位置新建文档"
          onClick={() => setCreateOpen(true)}
        >
          +
        </button>
        {renderRowMenu(doc)}
      </div>
    </div>
  );

  const renderFolderTree = (parentId: string | null, depth: number): React.ReactNode => {
    const items = childFolders.get(parentId) ?? [];
    return items.map((folder) => {
      const children = childFolders.get(folder.id) ?? [];
      const isOpen = expanded[folder.id] ?? false;
      return (
        <div key={folder.id}>
          <div className={styles.sidebarFolderRow} style={{ paddingLeft: depth * 12 }}>
            {children.length > 0 ? (
              <button
                type="button"
                className={styles.sidebarFolderToggle}
                onClick={() => setExpanded((prev) => ({ ...prev, [folder.id]: !isOpen }))}
              >
                {isOpen ? '▾' : '▸'}
              </button>
            ) : (
              <span className={styles.sidebarFolderToggle} />
            )}
            <button
              type="button"
              className={`${styles.sidebarItem} ${
                scope === 'owned' && folderId === folder.id ? styles.sidebarItemActive : ''
              }`}
              onClick={() => {
                setScope('owned');
                setFolderId(folder.id);
              }}
              onContextMenu={(event) => openFolderMenu(event, folder)}
            >
              <span className={styles.sidebarItemText}>{folder.name}</span>
            </button>
          </div>
          {isOpen ? renderFolderTree(folder.id, depth + 1) : null}
        </div>
      );
    });
  };

  const menuDoc = contextMenu?.kind === 'document' ? contextMenu.doc : null;
  const menuFolder = contextMenu?.kind === 'folder' ? contextMenu.folder : null;

  return (
    <div className={styles.page}>
      <TopBar />
      <VerifyEmailBanner />

      <div className={styles.docsLayout}>
        <aside className={styles.sidebar}>
          <button type="button" className={styles.sidebarNew} onClick={() => setCreateOpen(true)}>
            + 新建
          </button>
          <label
            className={styles.sidebarItem}
            style={{ cursor: 'pointer', marginBottom: 8 }}
            title="支持 .md / .txt / .drawnix / .json"
          >
            <span className={styles.sidebarItemText}>导入文件</span>
            <input
              type="file"
              accept=".md,.markdown,.txt,.json,.drawnix"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = '';
              }}
            />
          </label>

          <div className={styles.sidebarSection}>团队空间</div>
          {teams.length > 0
            ? teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className={`${styles.sidebarItem} ${
                    teamId === team.id ? styles.sidebarItemActive : ''
                  }`}
                  title={`${team.name}${team.readonly ? '（只读）' : ''}`}
                  onClick={() => {
                    setTeamId(team.id === teamId ? null : team.id);
                    setFolderId(null);
                    setScope('owned');
                    setPage(1);
                  }}
                >
                  <span className={styles.sidebarItemText}>{team.name}</span>
                  {team.readonly ? <span className={styles.tag}>只读</span> : null}
                </button>
              ))
            : null}

          <button
            type="button"
            className={styles.sidebarItem}
            onClick={async () => {
              const token = window.prompt('粘贴团队邀请令牌（由管理员生成）');
              if (!token?.trim()) return;
              try {
                const result = await teamApi.join(token.trim());
                await loadTeams();
                setTeamId(result.teamId);
                setScope('owned');
                setFolderId(null);
                setPage(1);
                if (result.already) window.alert('你已经在这个团队里了');
              } catch (caught) {
                window.alert(caught instanceof ApiError ? caught.message : '加入失败');
              }
            }}
          >
            <span className={styles.sidebarItemText}>+ 加入团队</span>
          </button>

          <div className={styles.sidebarSection}>目录</div>
          {renderFolderTree(null, 0)}
          <button type="button" className={styles.sidebarItem} onClick={() => setFolderModalOpen(true)}>
            <span className={styles.sidebarItemText}>+ 新建目录</span>
          </button>
        </aside>

        <main className={styles.docsMain}>
          <div className={styles.tabs}>
            {SCOPE_ORDER.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`${styles.tab} ${scope === item.key ? styles.tabActive : ''}`}
                onClick={() => {
                  setScope(item.key);
                  setFolderId(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className={styles.docsToolbar}>
            <div className={styles.breadcrumb}>
              <button
                type="button"
                className={styles.breadcrumbItem}
                onClick={() => {
                  setScope('owned');
                  setFolderId(null);
                }}
              >
                {SCOPE_LABEL[scope]}
              </button>
              {breadcrumb.map((folder) => (
                <span key={folder.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span>/</span>
                  <button
                    type="button"
                    className={styles.breadcrumbItem}
                    onClick={() => setFolderId(folder.id)}
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </div>

            <span className={styles.grow} />

            <input
              className={styles.searchInput}
              placeholder="搜索文档名称"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setQuery(search.trim());
              }}
            />
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSm}`}
              onClick={() => setQuery(search.trim())}
            >
              搜索
            </button>

            <div className={styles.segmented}>
              <button
                type="button"
                className={`${styles.segmentedItem} ${
                  view === 'list' ? styles.segmentedItemActive : ''
                }`}
                onClick={() => setView('list')}
                title="列表视图"
              >
                列表
              </button>
              <button
                type="button"
                className={`${styles.segmentedItem} ${
                  view === 'card' ? styles.segmentedItemActive : ''
                }`}
                onClick={() => setView('card')}
                title="卡片视图"
              >
                卡片
              </button>
            </div>
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}

          {scope === 'trash' && retentionDays ? (
            <div className={styles.hint} style={{ marginBottom: 10 }}>
              最近删除的文档会保留 {retentionDays} 天，超过后自动彻底删除（可在管理后台调整）。
            </div>
          ) : null}

          {loading ? (
            <div className={styles.center}>加载中…</div>
          ) : documents.length === 0 ? (
            <div className={styles.empty}>
              <div>{currentFolderName}</div>
              <div className={styles.hint}>
                {scope === 'trash'
                  ? '回收站是空的'
                  : query
                    ? '没有匹配的文档'
                    : '这里还没有文档，点击左上角「新建」开始'}
              </div>
            </div>
          ) : view === 'list' ? (
            <div className={styles.listWrap}>
              <div className={styles.listHeaderRow}>
                <span>名称</span>
                <span>所有者</span>
                <span>位置</span>
                <span>最近查看</span>
                <span style={{ textAlign: 'right' }}>大小</span>
              </div>
              {documents.map(renderListItem)}
            </div>
          ) : (
            <div className={styles.grid}>{documents.map(renderCard)}</div>
          )}

          {totalPages > 1 ? (
            <div className={styles.pagination}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSm}`}
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                上一页
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSm}`}
                disabled={page >= totalPages}
                onClick={() => setPage((prev) => prev + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </main>
      </div>

      <Modal open={createOpen} title="新建" onClose={() => setCreateOpen(false)}>
        <div className={styles.grid}>
          {(Object.keys(TYPE_META) as DocumentType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={styles.card}
              style={{ border: 'none', textAlign: 'left' }}
              disabled={busy}
              onClick={() => {
                // 选完类型后进入「最近文档 + 选模板」，与顶栏入口保持一致
                setCreateOpen(false);
                setNewDocType(type);
              }}
            >
              <div className={styles.cardIcon}>
                <DocIcon type={type} />
              </div>
              <div className={styles.cardTitle}>{TYPE_META[type].label}</div>
            </button>
          ))}
        </div>
      </Modal>

      <NewDocumentDialog
        type={newDocType}
        folderId={scope === 'owned' && !teamId ? folderId : null}
        teamId={teamId}
        onClose={() => setNewDocType(null)}
      />

      <Modal open={folderModalOpen} title="新建目录" onClose={() => setFolderModalOpen(false)}>
        <div className={styles.field}>
          <span className={styles.label}>目录名称</span>
          <input
            className={styles.input}
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createFolder();
            }}
            autoFocus
          />
        </div>
        <div className={styles.row} style={{ justifyContent: 'flex-end' }}>
          <button type="button" className={styles.button} onClick={() => setFolderModalOpen(false)}>
            取消
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={busy || !folderName.trim()}
            onClick={createFolder}
          >
            创建
          </button>
        </div>
      </Modal>

      <Modal open={!!renameTarget} title="重命名" onClose={() => setRenameTarget(null)}>
        <div className={styles.field}>
          <span className={styles.label}>文档名称</span>
          <input
            className={styles.input}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void rename();
            }}
            autoFocus
          />
        </div>
        <div className={styles.row} style={{ justifyContent: 'flex-end' }}>
          <button type="button" className={styles.button} onClick={() => setRenameTarget(null)}>
            取消
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={busy || !renameValue.trim()}
            onClick={rename}
          >
            保存
          </button>
        </div>
      </Modal>

      <Modal open={!!moveTarget} title="移动到目录" onClose={() => setMoveTarget(null)}>
        <div className={styles.listWrap}>
          <button
            type="button"
            className={styles.sidebarItem}
            onClick={() => moveTo(null)}
          >
            我的文档（根目录）
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={styles.sidebarItem}
              onClick={() => moveTo(folder.id)}
            >
              <span className={styles.sidebarItemText}>{folder.name}</span>
            </button>
          ))}
        </div>
      </Modal>

      {contextMenu && menuDoc ? (
        <div
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => {
              setContextMenu(null);
              openDocument(menuDoc);
            }}
          >
            打开
          </button>
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => {
              setContextMenu(null);
              setRenameTarget(menuDoc);
              setRenameValue(menuDoc.title);
            }}
          >
            重命名
          </button>
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => {
              setContextMenu(null);
              setMoveTarget(menuDoc);
            }}
          >
            移动到目录
          </button>
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => {
              setContextMenu(null);
              void toggleStar(menuDoc);
            }}
          >
            {menuDoc.starred ? '取消收藏' : '收藏文档'}
          </button>
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => {
              setContextMenu(null);
              setShareTarget(menuDoc);
            }}
          >
            分享
          </button>
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => {
              setContextMenu(null);
              void duplicateDocument(menuDoc);
            }}
          >
            创建副本
          </button>
          <button
            type="button"
            className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
            onClick={() => {
              setContextMenu(null);
              void removeDocument(menuDoc);
            }}
          >
            移到最近删除
          </button>
        </div>
      ) : null}

      {contextMenu && menuFolder ? (
        <div
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => {
              setContextMenu(null);
              setScope('owned');
              setFolderId(menuFolder.id);
            }}
          >
            打开目录
          </button>
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => void renameFolder(menuFolder)}
          >
            重命名
          </button>
          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => {
              setContextMenu(null);
              setFolderId(menuFolder.id);
              setFolderModalOpen(true);
            }}
          >
            新建子目录
          </button>
          <button
            type="button"
            className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
            onClick={() => void removeFolder(menuFolder)}
          >
            删除目录
          </button>
        </div>
      ) : null}

      {shareTarget ? (
        <ShareDialog
          open
          document={shareTarget}
          onClose={() => {
            setShareTarget(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
