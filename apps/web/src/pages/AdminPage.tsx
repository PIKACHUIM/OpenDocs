import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  adminApi,
  type AdminAsset,
  type AdminInviteCode,
  type AdminSettings,
  type AdminStats,
  type AdminUser,
  type ApiDocument,
  type DocumentType,
} from '../api';
import { navigate } from '../lib/router';
import { useAuth } from '../lib/auth';
import { TopBar } from '../ui/TopBar';
import styles from '../ui/common.module.scss';

type Tab = 'overview' | 'users' | 'documents' | 'assets' | 'invites' | 'settings';

const PAGE_SIZE = 20;

const TYPE_LABEL: Record<DocumentType, string> = {
  mindmap: '思维导图',
  markdown: 'Markdown',
  word: 'Word',
  excel: 'Excel',
  ppt: 'PPT',
};

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

export function AdminPage() {
  const { user, loading: authLoading, isAdmin, refresh } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [stats, setStats] = useState<AdminStats | null>(null);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userQuery, setUserQuery] = useState('');

  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [documentPage, setDocumentPage] = useState(1);
  const [documentQuery, setDocumentQuery] = useState('');

  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [assets, setAssets] = useState<AdminAsset[]>([]);
  const [assetTotal, setAssetTotal] = useState(0);
  const [assetPage, setAssetPage] = useState(1);
  const [unreferenced, setUnreferenced] = useState(0);

  const [invites, setInvites] = useState<AdminInviteCode[]>([]);
  const [inviteForm, setInviteForm] = useState({
    code: '',
    maxUses: 1,
    expiresAt: '',
    note: '',
  });

  const [settingsForm, setSettingsForm] = useState<{
    siteName: string;
    siteUrl: string;
    allowRegistration: boolean;
    inviteRequired: boolean;
    trashRetentionDays: number;
    /** 以下以 MB 编辑，提交时换算成字节 */
    allowImage: boolean;
    allowFile: boolean;
    maxImageMB: number;
    maxFileMB: number;
    userQuotaMB: number;
    systemQuotaMB: number;
    resendApiKey: string;
    resendFrom: string;
    turnstileEnabled: boolean;
    turnstileSiteKey: string;
    turnstileSecretKey: string;
  } | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setStats(await adminApi.stats());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '统计加载失败');
    }
  }, []);

  const loadUsers = useCallback(async (page: number, query: string) => {
    try {
      const data = await adminApi.users({ page, pageSize: PAGE_SIZE, q: query || undefined });
      setUsers(data.users);
      setUserTotal(data.total);
      setUserPage(data.page);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '用户列表加载失败');
    }
  }, []);

  const loadDocuments = useCallback(async (page: number, query: string) => {
    try {
      const data = await adminApi.documents({ page, pageSize: PAGE_SIZE, q: query || undefined });
      setDocuments(data.documents);
      setDocumentTotal(data.total);
      setDocumentPage(data.page);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '文档列表加载失败');
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const data = await adminApi.settings();
      setSettings(data);
      setSettingsForm({
        siteName: data.siteName,
        siteUrl: data.siteUrl,
        allowRegistration: data.allowRegistration,
        inviteRequired: data.inviteRequired,
        trashRetentionDays: data.trashRetentionDays,
        allowImage: data.allowImage,
        allowFile: data.allowFile,
        maxImageMB: Math.round(data.maxImageBytes / 1024 / 1024),
        maxFileMB: Math.round(data.maxFileBytes / 1024 / 1024),
        userQuotaMB: Math.round(data.userQuotaBytes / 1024 / 1024),
        systemQuotaMB: Math.round(data.systemQuotaBytes / 1024 / 1024),
        resendApiKey: '',
        resendFrom: data.resendFrom ?? '',
        turnstileEnabled: data.turnstileEnabled,
        turnstileSiteKey: data.turnstileSiteKey ?? '',
        turnstileSecretKey: '',
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '设置加载失败');
    }
  }, []);

  const loadAssets = useCallback(async (page: number) => {
    try {
      const data = await adminApi.assets({ page, pageSize: PAGE_SIZE });
      setAssets(data.assets);
      setAssetTotal(data.total);
      setUnreferenced(data.unreferenced);
      setAssetPage(data.page);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '附件列表加载失败');
    }
  }, []);

  const loadInvites = useCallback(async () => {
    try {
      const data = await adminApi.invites();
      setInvites(data.invites);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '邀请码加载失败');
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    setError(null);
    if (tab === 'overview') void loadStats();
    if (tab === 'users') void loadUsers(1, userQuery);
    if (tab === 'documents') void loadDocuments(1, documentQuery);
    if (tab === 'assets') void loadAssets(1);
    if (tab === 'invites') void loadInvites();
    if (tab === 'settings') void loadSettings();
    // 只在切换 tab 时按当前已有的搜索词触发一次加载
  }, [tab, isAdmin, loadStats, loadUsers, loadDocuments, loadAssets, loadInvites, loadSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: () => Promise<void>, successMessage?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className={styles.page}>
        <TopBar />
        <div className={styles.center}>加载中…</div>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className={styles.page}>
        <TopBar />
        <div className={styles.content}>
          <div className={styles.listWrap} style={{ padding: 24 }}>
            <p className={styles.hint}>{user ? '当前账号没有管理员权限。' : '需要登录管理员账号才能访问。'}</p>
            <button className={styles.button} onClick={() => navigate(user ? '/documents' : '/login')}>
              {user ? '返回文档中心' : '去登录'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const userPages = Math.max(1, Math.ceil(userTotal / PAGE_SIZE));
  const documentPages = Math.max(1, Math.ceil(documentTotal / PAGE_SIZE));

  const submitSettings = async () => {
    if (!settingsForm) return;
    await run(async () => {
      const updated = await adminApi.updateSettings({
        siteName: settingsForm.siteName,
        siteUrl: settingsForm.siteUrl,
        allowRegistration: settingsForm.allowRegistration,
        inviteRequired: settingsForm.inviteRequired,
        trashRetentionDays: settingsForm.trashRetentionDays,
        uploadAllowImage: settingsForm.allowImage,
        uploadAllowFile: settingsForm.allowFile,
        uploadMaxImageBytes: settingsForm.maxImageMB * 1024 * 1024,
        uploadMaxFileBytes: settingsForm.maxFileMB * 1024 * 1024,
        quotaUserBytes: settingsForm.userQuotaMB * 1024 * 1024,
        quotaSystemBytes: settingsForm.systemQuotaMB * 1024 * 1024,
        resendApiKey: settingsForm.resendApiKey ? settingsForm.resendApiKey : undefined,
        resendFrom: settingsForm.resendFrom,
        turnstileEnabled: settingsForm.turnstileEnabled,
        turnstileSiteKey: settingsForm.turnstileSiteKey,
        turnstileSecretKey: settingsForm.turnstileSecretKey ? settingsForm.turnstileSecretKey : undefined,
      });
      setSettings(updated);
      setSettingsForm((previous) => (previous ? { ...previous, resendApiKey: '', turnstileSecretKey: '' } : previous));
      // 重新拉一次公开配置，让站点名称等改动立即生效（如标签页标题）
      await refresh();
    }, '设置已保存');
  };

  const createInvite = () =>
    run(async () => {
      await adminApi.createInvite({
        code: inviteForm.code.trim() || undefined,
        maxUses: inviteForm.maxUses,
        // 以当天 23:59:59 作为截止，避免选「今天」却立刻过期
        expiresAt: inviteForm.expiresAt
          ? new Date(`${inviteForm.expiresAt}T23:59:59`).toISOString()
          : null,
        note: inviteForm.note.trim() || undefined,
      });
      setInviteForm({ code: '', maxUses: 1, expiresAt: '', note: '' });
      await loadInvites();
    }, '邀请码已创建');

  const toggleInvite = (invite: AdminInviteCode) =>
    run(async () => {
      await adminApi.updateInvite(invite.id, { disabled: !invite.disabled });
      await loadInvites();
    }, invite.disabled ? '邀请码已启用' : '邀请码已停用');

  const deleteInvite = (invite: AdminInviteCode) => {
    if (!window.confirm(`删除邀请码「${invite.code}」？`)) return;
    void run(async () => {
      await adminApi.deleteInvite(invite.id);
      await loadInvites();
    }, '邀请码已删除');
  };

  return (
    <div className={styles.page}>
      <TopBar />
      <div className={styles.content}>
        <div className={styles.sectionHeader}>
          <h1>管理后台</h1>
          <span className={styles.hint}>存储驱动：{stats?.storage ?? '—'}</span>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
        {notice ? <div className={styles.success}>{notice}</div> : null}

        <div className={styles.tabs}>
          {(
            [
              ['overview', '概览'],
              ['users', '用户管理'],
              ['documents', '文档管理'],
              ['assets', '附件管理'],
              ['invites', '邀请码'],
              ['settings', '系统设置'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' ? (
          stats ? (
            <>
              <div className={styles.stats}>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{stats.users.total}</div>
                  <div className={styles.statLabel}>用户总数</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{stats.users.admins}</div>
                  <div className={styles.statLabel}>管理员</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{stats.documents.total}</div>
                  <div className={styles.statLabel}>文档总数</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{stats.documents.shared}</div>
                  <div className={styles.statLabel}>分享中</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{stats.documents.trashed}</div>
                  <div className={styles.statLabel}>回收站</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{formatBytes(stats.documents.storageBytes)}</div>
                  <div className={styles.statLabel}>内容占用</div>
                </div>
              </div>
              <div className={styles.row} style={{ marginBottom: 18 }}>
                {stats.documents.byType.map((item) => (
                  <span key={item.type} className={styles.tag}>
                    {TYPE_LABEL[item.type]} · {item.n}
                  </span>
                ))}
              </div>
              <button className={styles.button} onClick={() => void run(loadStats)} disabled={busy}>
                刷新统计
              </button>
            </>
          ) : (
            <div className={styles.center}>加载中…</div>
          )
        ) : null}

        {tab === 'users' ? (
          <>
            <div className={styles.row} style={{ marginBottom: 14 }}>
              <input
                className={styles.input}
                style={{ maxWidth: 260 }}
                placeholder="搜索邮箱 / 昵称 / ID"
                value={userQuery}
                onChange={(event) => setUserQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadUsers(1, userQuery);
                }}
              />
              <button className={styles.button} onClick={() => loadUsers(1, userQuery)} disabled={busy}>
                搜索
              </button>
              <span className={styles.grow} />
              <span className={styles.hint}>共 {userTotal} 人</span>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>文档数</th>
                    <th>最后登录</th>
                    <th style={{ width: 280 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{item.displayName}</div>
                        <div className={styles.hint}>{item.email}</div>
                      </td>
                      <td>
                        <span className={item.role === 'admin' ? styles.tag : styles.tagMuted}>
                          {item.role === 'admin' ? '管理员' : '普通用户'}
                        </span>
                      </td>
                      <td>
                        {item.disabled ? <span className={styles.tagDanger}>已禁用</span> : <span className={styles.tagSuccess}>正常</span>}
                        {!item.emailVerified ? <span className={styles.tagMuted} style={{ marginLeft: 4 }}>未验证邮箱</span> : null}
                      </td>
                      <td>{item.documentCount}</td>
                      <td>{item.lastLoginAt ? formatTime(item.lastLoginAt) : '从未'}</td>
                      <td>
                        <div className={styles.row}>
                          <button
                            className={`${styles.button} ${styles.buttonSm}`}
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await adminApi.updateUser(item.id, { role: item.role === 'admin' ? 'user' : 'admin' });
                                await loadUsers(userPage, userQuery);
                              }, '角色已更新')
                            }
                          >
                            {item.role === 'admin' ? '降为普通' : '设为管理员'}
                          </button>
                          <button
                            className={`${styles.button} ${styles.buttonSm}`}
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await adminApi.updateUser(item.id, { disabled: !item.disabled });
                                await loadUsers(userPage, userQuery);
                              }, item.disabled ? '已启用' : '已禁用')
                            }
                          >
                            {item.disabled ? '启用' : '禁用'}
                          </button>
                          <button
                            className={`${styles.button} ${styles.buttonSm}`}
                            disabled={busy}
                            onClick={() => {
                              const password = window.prompt(`为 ${item.email} 设置新密码（至少 8 位）`);
                              if (!password) return;
                              void run(async () => {
                                await adminApi.updateUser(item.id, { password });
                              }, '密码已重置，该用户所有会话已失效');
                            }}
                          >
                            重置密码
                          </button>
                          <button
                            className={`${styles.button} ${styles.buttonSm} ${styles.buttonDanger}`}
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`删除用户「${item.displayName}」？其名下 ${item.documentCount} 个文档会一并删除。`)) return;
                              void run(async () => {
                                await adminApi.deleteUser(item.id);
                                await loadUsers(userPage, userQuery);
                              }, '用户已删除');
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className={styles.empty}>没有匹配的用户</div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {userPages > 1 ? (
              <div className={styles.pagination}>
                <button className={styles.button} disabled={userPage <= 1 || busy} onClick={() => loadUsers(userPage - 1, userQuery)}>
                  上一页
                </button>
                <span>
                  {userPage} / {userPages}
                </span>
                <button className={styles.button} disabled={userPage >= userPages || busy} onClick={() => loadUsers(userPage + 1, userQuery)}>
                  下一页
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === 'documents' ? (
          <>
            <div className={styles.row} style={{ marginBottom: 14 }}>
              <input
                className={styles.input}
                style={{ maxWidth: 260 }}
                placeholder="搜索标题 / ID"
                value={documentQuery}
                onChange={(event) => setDocumentQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadDocuments(1, documentQuery);
                }}
              />
              <button className={styles.button} onClick={() => loadDocuments(1, documentQuery)} disabled={busy}>
                搜索
              </button>
              <span className={styles.grow} />
              <span className={styles.hint}>共 {documentTotal} 个</span>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>标题</th>
                    <th>类型</th>
                    <th>所有者</th>
                    <th>大小</th>
                    <th>分享</th>
                    <th>更新时间</th>
                    <th style={{ width: 160 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{item.title}</div>
                        <div className={styles.hint}>{item.id}</div>
                      </td>
                      <td>
                        <span className={styles.tag}>{TYPE_LABEL[item.type]}</span>
                      </td>
                      <td>{item.ownerName ?? item.ownerId}</td>
                      <td>{formatBytes(item.sizeBytes)}</td>
                      <td>
                        {item.linkShared ? (
                          <span className={styles.tagSuccess}>{item.linkMode === 'edit' ? '可编辑' : '只读'}</span>
                        ) : (
                          <span className={styles.tagMuted}>未分享</span>
                        )}
                      </td>
                      <td>{formatTime(item.updatedAt)}</td>
                      <td>
                        <div className={styles.row}>
                          <button className={`${styles.button} ${styles.buttonSm}`} onClick={() => navigate(`/d/${item.id}`)}>
                            打开
                          </button>
                          <button
                            className={`${styles.button} ${styles.buttonSm} ${styles.buttonDanger}`}
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`彻底删除文档「${item.title}」？该操作不可恢复。`)) return;
                              void run(async () => {
                                await adminApi.deleteDocument(item.id);
                                await loadDocuments(documentPage, documentQuery);
                              }, '文档已删除');
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {documents.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className={styles.empty}>没有匹配的文档</div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {documentPages > 1 ? (
              <div className={styles.pagination}>
                <button className={styles.button} disabled={documentPage <= 1 || busy} onClick={() => loadDocuments(documentPage - 1, documentQuery)}>
                  上一页
                </button>
                <span>
                  {documentPage} / {documentPages}
                </span>
                <button className={styles.button} disabled={documentPage >= documentPages || busy} onClick={() => loadDocuments(documentPage + 1, documentQuery)}>
                  下一页
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === 'assets' ? (
          <div>
            <div
              className={styles.row}
              style={{ justifyContent: 'space-between', marginBottom: 12 }}
            >
              <span className={styles.hint}>
                共 {assetTotal} 个附件 · {unreferenced} 个无引用（所属文档已彻底删除）
              </span>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonDanger}`}
                disabled={busy || unreferenced === 0}
                onClick={() =>
                  run(async () => {
                    await adminApi.cleanupAssets();
                    await loadAssets(assetPage);
                  }, '已清理无引用附件')
                }
              >
                清理无引用
              </button>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>预览</th>
                    <th>所属用户</th>
                    <th>大小</th>
                    <th>创建时间</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: '#86909c', padding: 32 }}>
                        还没有附件
                      </td>
                    </tr>
                  ) : (
                    assets.map((asset) => (
                      <tr key={asset.id}>
                        <td>
                          <img
                            src={asset.url}
                            alt=""
                            style={{
                              width: 44,
                              height: 44,
                              objectFit: 'cover',
                              borderRadius: 6,
                              border: '1px solid #e5e6eb',
                            }}
                          />
                        </td>
                        <td>{asset.ownerEmail ?? '—'}</td>
                        <td>{(asset.sizeBytes / 1024).toFixed(0)} KB</td>
                        <td>{formatTime(asset.createdAt)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className={`${styles.button} ${styles.buttonSm}`}
                            onClick={() => window.open(asset.url, '_blank', 'noopener')}
                          >
                            查看
                          </button>{' '}
                          <button
                            type="button"
                            className={`${styles.button} ${styles.buttonSm} ${styles.buttonDanger}`}
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm('删除该附件？引用它的文档会显示裂图。')) return;
                              void run(async () => {
                                await adminApi.deleteAsset(asset.id);
                                await loadAssets(assetPage);
                              }, '附件已删除');
                            }}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {Math.ceil(assetTotal / PAGE_SIZE) > 1 ? (
              <div className={styles.pagination}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSm}`}
                  disabled={assetPage <= 1}
                  onClick={() => void loadAssets(Math.max(1, assetPage - 1))}
                >
                  上一页
                </button>
                <span>
                  {assetPage} / {Math.ceil(assetTotal / PAGE_SIZE)}
                </span>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSm}`}
                  disabled={assetPage >= Math.ceil(assetTotal / PAGE_SIZE)}
                  onClick={() => void loadAssets(assetPage + 1)}
                >
                  下一页
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'invites' ? (
          <div>
            <div className={styles.listWrap} style={{ padding: 20, marginBottom: 16 }}>
              <div className={styles.row} style={{ alignItems: 'flex-end', gap: 12 }}>
                <div className={styles.field} style={{ marginBottom: 0, minWidth: 170 }}>
                  <span className={styles.label}>邀请码（留空自动生成）</span>
                  <input
                    className={styles.input}
                    placeholder="如 TEAM-2026"
                    value={inviteForm.code}
                    onChange={(event) =>
                      setInviteForm({ ...inviteForm, code: event.target.value.toUpperCase() })
                    }
                  />
                </div>
                <div className={styles.field} style={{ marginBottom: 0, width: 110 }}>
                  <span className={styles.label}>可用次数</span>
                  <input
                    className={styles.input}
                    type="number"
                    min={1}
                    max={10000}
                    value={inviteForm.maxUses}
                    onChange={(event) =>
                      setInviteForm({
                        ...inviteForm,
                        maxUses: Number.parseInt(event.target.value, 10) || 1,
                      })
                    }
                  />
                </div>
                <div className={styles.field} style={{ marginBottom: 0, width: 170 }}>
                  <span className={styles.label}>有效期（留空永久）</span>
                  <input
                    className={styles.input}
                    type="date"
                    value={inviteForm.expiresAt}
                    onChange={(event) => setInviteForm({ ...inviteForm, expiresAt: event.target.value })}
                  />
                </div>
                <div className={styles.field} style={{ marginBottom: 0, flex: 1, minWidth: 150 }}>
                  <span className={styles.label}>备注</span>
                  <input
                    className={styles.input}
                    placeholder="给谁用的"
                    value={inviteForm.note}
                    onChange={(event) => setInviteForm({ ...inviteForm, note: event.target.value })}
                  />
                </div>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  disabled={busy}
                  onClick={createInvite}
                >
                  创建
                </button>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>邀请码</th>
                    <th>用量</th>
                    <th>有效期</th>
                    <th>备注</th>
                    <th>状态</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: '#86909c', padding: 32 }}>
                        还没有邀请码
                      </td>
                    </tr>
                  ) : (
                    invites.map((invite) => (
                      <tr key={invite.id}>
                        <td>
                          <button
                            type="button"
                            className={`${styles.button} ${styles.buttonGhost} ${styles.buttonSm}`}
                            onClick={() => {
                              void navigator.clipboard?.writeText(invite.code);
                            }}
                            title="点击复制"
                          >
                            {invite.code}
                          </button>
                        </td>
                        <td>
                          {invite.usedCount} / {invite.maxUses}
                        </td>
                        <td>{invite.expiresAt ? formatTime(invite.expiresAt) : '永久'}</td>
                        <td>{invite.note ?? '-'}</td>
                        <td>
                          <span
                            className={`${styles.tag} ${
                              invite.usable ? styles.tagSuccess : styles.tagMuted
                            }`}
                          >
                            {invite.usable ? '可用' : invite.disabled ? '已停用' : '已失效'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className={`${styles.button} ${styles.buttonSm}`}
                            disabled={busy}
                            onClick={() => toggleInvite(invite)}
                          >
                            {invite.disabled ? '启用' : '停用'}
                          </button>{' '}
                          <button
                            type="button"
                            className={`${styles.button} ${styles.buttonSm} ${styles.buttonDanger}`}
                            disabled={busy}
                            onClick={() => deleteInvite(invite)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === 'settings' && settingsForm ? (
          <div className={styles.listWrap} style={{ padding: 20, maxWidth: 560 }}>
            <div className={styles.field}>
              <span className={styles.label}>站点名称</span>
              <input
                className={styles.input}
                value={settingsForm.siteName}
                onChange={(event) => setSettingsForm({ ...settingsForm, siteName: event.target.value })}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>站点 URL（用于邮件里的链接，如 https://docs.example.com）</span>
              <input
                className={styles.input}
                value={settingsForm.siteUrl}
                onChange={(event) => setSettingsForm({ ...settingsForm, siteUrl: event.target.value })}
              />
            </div>
            <label className={styles.checkboxRow} style={{ marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={settingsForm.allowRegistration}
                onChange={(event) => setSettingsForm({ ...settingsForm, allowRegistration: event.target.checked })}
              />
              允许新用户自助注册
            </label>
            <label className={styles.checkboxRow} style={{ marginBottom: 16, marginTop: -8 }}>
              <input
                type="checkbox"
                checked={settingsForm.inviteRequired}
                onChange={(event) => setSettingsForm({ ...settingsForm, inviteRequired: event.target.checked })}
              />
              注册必须使用邀请码
            </label>
            <p className={styles.hint} style={{ marginTop: -8 }}>
              开启后，注册页会要求填写有效邀请码；邀请码在「邀请码」标签页创建，可设置可用次数与有效期。
            </p>

            <div className={styles.field} style={{ marginTop: 12 }}>
              <span className={styles.label}>删除文档保留时长（天，1–365）</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={365}
                value={settingsForm.trashRetentionDays}
                onChange={(event) =>
                  setSettingsForm({
                    ...settingsForm,
                    trashRetentionDays: Number.parseInt(event.target.value, 10) || 30,
                  })
                }
              />
              <span className={styles.hint}>
                「最近删除」中的文档超过该天数后，会在打开列表时自动彻底清理（含对象存储中的正文）。
              </span>
            </div>

            <h3 style={{ fontSize: 14, margin: '20px 0 10px' }}>上传与容量</h3>
            <label className={styles.checkboxRow} style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={settingsForm.allowImage}
                onChange={(event) =>
                  setSettingsForm({ ...settingsForm, allowImage: event.target.checked })
                }
              />
              允许上传图片
            </label>
            <label className={styles.checkboxRow} style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={settingsForm.allowFile}
                onChange={(event) =>
                  setSettingsForm({ ...settingsForm, allowFile: event.target.checked })
                }
              />
              允许上传附件文件
            </label>

            <div className={styles.field}>
              <span className={styles.label}>单张图片上限（MB）</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                value={settingsForm.maxImageMB}
                onChange={(event) =>
                  setSettingsForm({
                    ...settingsForm,
                    maxImageMB: Number.parseInt(event.target.value, 10) || 1,
                  })
                }
              />
            </div>

            <div className={styles.field}>
              <span className={styles.label}>单个附件上限（MB）</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                value={settingsForm.maxFileMB}
                onChange={(event) =>
                  setSettingsForm({
                    ...settingsForm,
                    maxFileMB: Number.parseInt(event.target.value, 10) || 1,
                  })
                }
              />
            </div>

            <div className={styles.field}>
              <span className={styles.label}>每个用户容量（MB，0 表示不限）</span>
              <input
                className={styles.input}
                type="number"
                min={0}
                value={settingsForm.userQuotaMB}
                onChange={(event) =>
                  setSettingsForm({
                    ...settingsForm,
                    userQuotaMB: Number.parseInt(event.target.value, 10) || 0,
                  })
                }
              />
            </div>

            <div className={styles.field}>
              <span className={styles.label}>系统总容量（MB，0 表示不限）</span>
              <input
                className={styles.input}
                type="number"
                min={0}
                value={settingsForm.systemQuotaMB}
                onChange={(event) =>
                  setSettingsForm({
                    ...settingsForm,
                    systemQuotaMB: Number.parseInt(event.target.value, 10) || 0,
                  })
                }
              />
            </div>

            <h3 style={{ fontSize: 14, margin: '20px 0 10px' }}>Resend 邮件配置</h3>
            <div className={styles.field}>
              <span className={styles.label}>
                API Key {settings?.resendApiKeySet ? <span className={styles.tagSuccess}>已配置：{settings.resendApiKeyMasked}</span> : <span className={styles.tagMuted}>未配置</span>}
              </span>
              <input
                className={styles.input}
                type="password"
                placeholder="留空则不修改；填入新值以更新"
                value={settingsForm.resendApiKey}
                onChange={(event) => setSettingsForm({ ...settingsForm, resendApiKey: event.target.value })}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>发信地址（From，如 no-reply@yourdomain.com）</span>
              <input
                className={styles.input}
                value={settingsForm.resendFrom}
                onChange={(event) => setSettingsForm({ ...settingsForm, resendFrom: event.target.value })}
              />
            </div>

            <h3 style={{ fontSize: 14, margin: '20px 0 10px' }}>Cloudflare Turnstile 验证码</h3>
            <label className={styles.checkboxRow} style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={settingsForm.turnstileEnabled}
                onChange={(event) => setSettingsForm({ ...settingsForm, turnstileEnabled: event.target.checked })}
              />
              在注册/登录/找回密码页启用人机验证
            </label>
            <div className={styles.field}>
              <span className={styles.label}>Site Key</span>
              <input
                className={styles.input}
                value={settingsForm.turnstileSiteKey}
                onChange={(event) => setSettingsForm({ ...settingsForm, turnstileSiteKey: event.target.value })}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>
                Secret Key {settings?.turnstileSecretKeySet ? <span className={styles.tagSuccess}>已配置：{settings.turnstileSecretKeyMasked}</span> : <span className={styles.tagMuted}>未配置</span>}
              </span>
              <input
                className={styles.input}
                type="password"
                placeholder="留空则不修改；填入新值以更新"
                value={settingsForm.turnstileSecretKey}
                onChange={(event) => setSettingsForm({ ...settingsForm, turnstileSecretKey: event.target.value })}
              />
            </div>

            <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={submitSettings} disabled={busy}>
              保存设置
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
