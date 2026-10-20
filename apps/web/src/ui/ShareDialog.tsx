import { useEffect, useState } from 'react';
import { ApiError, documentApi, type ApiDocument, type DocumentMember, type LinkShareMode } from '../api';
import { Modal } from './Modal';
import { UserPicker } from './UserPicker';
import styles from './common.module.scss';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  document: ApiDocument;
  onChanged?: (document: ApiDocument) => void;
}

export function ShareDialog({ open, onClose, document, onChanged }: ShareDialogProps) {
  const [tab, setTab] = useState<'link' | 'members'>('link');
  const [mode, setMode] = useState<LinkShareMode>(document.linkMode ?? 'view');
  const [token, setToken] = useState<string | null>(null);
  const [members, setMembers] = useState<DocumentMember[]>([]);
  const [memberEmail, setMemberEmail] = useState('');
  /** 新协作者的默认权限：可读默认开，可改默认关 */
  const [newCanRead, setNewCanRead] = useState(true);
  const [newCanUpdate, setNewCanUpdate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab('link');
    setMode(document.linkMode ?? 'view');
    setToken(null);
    setError(null);
    setCopied(false);
    void documentApi
      .listMembers(document.id)
      .then((data) => setMembers(data.members))
      .catch(() => setMembers([]));
  }, [open, document.id, document.linkMode]);

  const link = token ? `${window.location.origin}/s/${token}` : null;

  const generateLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await documentApi.createShareLink(document.id, mode);
      setToken(data.share.token);
      onChanged?.(data.document);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '生成分享链接失败');
    } finally {
      setBusy(false);
    }
  };

  const revokeLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await documentApi.revokeShareLink(document.id);
      setToken(null);
      onChanged?.(data.document);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '关闭分享失败');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('浏览器阻止了剪贴板访问，请手动复制');
    }
  };

  const addMember = async () => {
    if (!memberEmail.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await documentApi.addMember(document.id, memberEmail.trim(), {
        canRead: newCanRead,
        canUpdate: newCanUpdate,
      });
      setMemberEmail('');
      const data = await documentApi.listMembers(document.id);
      setMembers(data.members);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '添加协作者失败');
    } finally {
      setBusy(false);
    }
  };

  /** 调整已有协作者的权限：服务端按 (文档, 用户) 做 upsert */
  const updateMember = async (
    member: DocumentMember,
    patch: { canRead?: boolean; canUpdate?: boolean }
  ) => {
    const canRead = patch.canRead ?? member.canRead ?? true;
    const canUpdate = patch.canUpdate ?? member.canUpdate ?? member.role === 'editor';
    if (!canRead && !canUpdate) {
      setError('至少要保留读取权限');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await documentApi.addMember(document.id, member.email, { canRead, canUpdate });
      const data = await documentApi.listMembers(document.id);
      setMembers(data.members);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '更新权限失败');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    setBusy(true);
    try {
      await documentApi.removeMember(document.id, userId);
      setMembers((list) => list.filter((member) => member.userId !== userId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '移除协作者失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={`分享「${document.title}」`} onClose={onClose}>
      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'link' ? styles.tabActive : ''}`}
          onClick={() => setTab('link')}
        >
          链接分享
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'members' ? styles.tabActive : ''}`}
          onClick={() => setTab('members')}
        >
          指定用户分享
        </button>
      </div>

      {tab === 'link' ? (
        <>
          <div className={styles.field}>
            <span className={styles.label}>访问权限</span>
            <label className={styles.checkboxRow} style={{ marginBottom: 6 }}>
              <input type="radio" checked={mode === 'view'} onChange={() => setMode('view')} />
              只读：任何拿到链接的人都能查看
            </label>
            <label className={styles.checkboxRow}>
              <input type="radio" checked={mode === 'edit'} onChange={() => setMode('edit')} />
              可编辑：无需登录即可直接修改并保存
            </label>
          </div>

          {link ? (
            <>
              <div className={styles.field}>
                <span className={styles.label}>分享链接</span>
                <div className={styles.linkBox}>
                  <input className={styles.input} readOnly value={link} onFocus={(e) => e.target.select()} />
                  <button type="button" className={styles.button} onClick={copyLink}>
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
              <div className={styles.row}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={generateLink}
                  disabled={busy}
                >
                  更新链接（改为{mode === 'edit' ? '可编辑' : '只读'}）
                </button>
                <button type="button" className={`${styles.button} ${styles.buttonDanger}`} onClick={revokeLink} disabled={busy}>
                  关闭分享
                </button>
              </div>
            </>
          ) : document.linkShared ? (
            <div className={styles.hint}>
              该文档已开启分享（{document.linkMode === 'edit' ? '可编辑' : '只读'}），点击下方按钮重新生成链接。
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={generateLink}
                  disabled={busy}
                >
                  生成新链接
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={generateLink}
              disabled={busy}
            >
              {busy ? '生成中…' : '生成分享链接'}
            </button>
          )}
        </>
      ) : (
        <>
          <div className={styles.row} style={{ marginBottom: 14 }}>
            <UserPicker
              placeholder="搜索站内用户（邮箱 / 昵称）"
              excludeIds={members.map((member) => member.userId)}
              disabled={busy}
              onPick={(picked) => {
                setMemberEmail(picked.email);
              }}
            />
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={newCanRead}
                onChange={(event) => setNewCanRead(event.target.checked)}
              />
              读取
            </label>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={newCanUpdate}
                onChange={(event) => setNewCanUpdate(event.target.checked)}
              />
              修改
            </label>
            <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={addMember} disabled={busy}>
              添加
            </button>
          </div>
          <p className={styles.hint} style={{ marginTop: -6, marginBottom: 12 }}>
            删除权限不对协作者开放，只有文档所有者可以删除。
          </p>

          {members.length === 0 ? (
            <div className={styles.hint}>还没有添加协作者，对方需要先注册账号才能被分享。</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {members.map((member) => (
                <div key={member.userId} className={styles.row} style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{member.displayName}</div>
                    <div className={styles.hint}>{member.email}</div>
                  </div>
                  <div className={styles.row}>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={member.canRead ?? true}
                        disabled={busy}
                        onChange={(event) =>
                          updateMember(member, {
                            canRead: event.target.checked,
                          })
                        }
                      />
                      读取
                    </label>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={member.canUpdate ?? member.role === 'editor'}
                        disabled={busy}
                        onChange={(event) =>
                          updateMember(member, {
                            canUpdate: event.target.checked,
                          })
                        }
                      />
                      修改
                    </label>
                    <label className={styles.checkboxRow} title="删除只属于所有者">
                      <input type="checkbox" checked={false} disabled />
                      删除
                    </label>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.buttonSm} ${styles.buttonDanger}`}
                      onClick={() => removeMember(member.userId)}
                      disabled={busy}
                    >
                      移除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
