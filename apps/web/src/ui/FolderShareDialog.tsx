import { useEffect, useState } from 'react';
import { ApiError, folderApi, type ApiFolder } from '../api';
import { Modal } from './Modal';
import { UserPicker } from './UserPicker';
import styles from './common.module.scss';

/**
 * 目录分享弹窗：给某个用户授予「创建 / 读取 / 修改 / 删除」。
 * 只有目录所有者（或管理员）能打开。
 */
export function FolderShareDialog({
  folder,
  onClose,
}: {
  folder: ApiFolder | null;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<
    Array<{
      userId: string;
      email: string;
      displayName: string;
      canCreate: boolean;
      canRead: boolean;
      canUpdate: boolean;
      canDelete: boolean;
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (folderId: string) => {
    const data = await folderApi.members(folderId);
    setMembers(data.members);
  };

  useEffect(() => {
    if (!folder) return;
    setError(null);
    void load(folder.id).catch((caught) =>
      setError(caught instanceof ApiError ? caught.message : '加载成员失败')
    );
  }, [folder]);

  const add = async (email: string) => {
    if (!folder) return;
    setBusy(true);
    setError(null);
    try {
      await folderApi.addMember(folder.id, {
        email,
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      });
      await load(folder.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '添加失败');
    } finally {
      setBusy(false);
    }
  };

  const update = async (
    member: (typeof members)[number],
    patch: Partial<Pick<(typeof members)[number], 'canCreate' | 'canRead' | 'canUpdate' | 'canDelete'>>
  ) => {
    if (!folder) return;
    setBusy(true);
    try {
      await folderApi.addMember(folder.id, {
        email: member.email,
        canCreate: patch.canCreate ?? member.canCreate,
        canRead: patch.canRead ?? member.canRead,
        canUpdate: patch.canUpdate ?? member.canUpdate,
        canDelete: patch.canDelete ?? member.canDelete,
      });
      await load(folder.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '更新失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={folder !== null} title={`分享目录「${folder?.name ?? ''}」`} onClose={onClose}>
      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.row} style={{ marginBottom: 12 }}>
        <UserPicker
          excludeIds={members.map((member) => member.userId)}
          disabled={busy}
          onPick={(user) => void add(user.email)}
        />
      </div>
      <p className={styles.hint} style={{ marginTop: -4, marginBottom: 12 }}>
        目录分享只影响该目录内的文档访问；文档自身的权限优先于目录。
      </p>

      {members.length === 0 ? (
        <div className={styles.hint}>还没有分享给任何人</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {members.map((member) => (
            <div
              key={member.userId}
              className={styles.row}
              style={{ justifyContent: 'space-between' }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {member.displayName || member.email}
                </div>
                <div className={styles.hint}>{member.email}</div>
              </div>
              <div className={styles.row}>
                {(
                  [
                    ['canCreate', '新建'],
                    ['canRead', '读取'],
                    ['canUpdate', '修改'],
                    ['canDelete', '删除'],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={member[field]}
                      disabled={busy}
                      onChange={(event) => void update(member, { [field]: event.target.checked })}
                    />
                    {label}
                  </label>
                ))}
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSm} ${styles.buttonDanger}`}
                  disabled={busy}
                  onClick={async () => {
                    if (!folder) return;
                    await folderApi.removeMember(folder.id, member.userId);
                    await load(folder.id);
                  }}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
