import { useEffect, useState } from 'react';
import { ApiError, teamApi, type ApiTeam, type ApiTeamMember } from '../api';
import { Modal } from './Modal';
import { UserPicker } from './UserPicker';
import styles from './common.module.scss';

/**
 * 团队空间管理（团队管理员视角）：成员与邀请链接。
 * 系统管理员在后台也有同样的能力，这里给团队管理员用。
 */
export function TeamManageDialog({
  team,
  onClose,
}: {
  team: ApiTeam | null;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<ApiTeamMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const load = async (teamId: string) => {
    const data = await teamApi.members(teamId);
    setMembers(data.members);
  };

  useEffect(() => {
    if (!team) return;
    setError(null);
    setToken(team.inviteToken);
    void load(team.id).catch((caught) =>
      setError(caught instanceof ApiError ? caught.message : '加载成员失败')
    );
  }, [team]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={team !== null} title={`团队空间「${team?.name ?? ''}」`} onClose={onClose}>
      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.row} style={{ gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (!team) return;
              const data = await teamApi.rotateInvite(team.id);
              setToken(data.inviteToken);
              await navigator.clipboard?.writeText(data.inviteToken).catch(() => undefined);
            })
          }
        >
          {token ? '重置邀请令牌' : '生成邀请令牌'}
        </button>
        {token ? (
          <button
            type="button"
            className={styles.button}
            onClick={() => void navigator.clipboard?.writeText(token).catch(() => undefined)}
          >
            复制令牌
          </button>
        ) : null}
      </div>
      {token ? (
        <p className={styles.hint} style={{ marginBottom: 12 }}>
          令牌：<code>{token}</code> · 成员在「文档管理 → 加入团队」粘贴即可，重置后旧令牌失效
        </p>
      ) : null}

      <div className={styles.row} style={{ marginBottom: 12 }}>
        <UserPicker
          excludeIds={members.map((member) => member.userId)}
          disabled={busy}
          onPick={(user) =>
            run(async () => {
              if (!team) return;
              await teamApi.addMember(team.id, user.email);
              await load(team.id);
            })
          }
        />
      </div>

      {members.length === 0 ? (
        <div className={styles.hint}>还没有成员</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>成员</th>
                <th>新建</th>
                <th>读取</th>
                <th>修改</th>
                <th>删除</th>
                <th>管理员</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td>
                    <div style={{ fontSize: 13 }}>{member.displayName || member.email}</div>
                    <div className={styles.hint}>{member.email}</div>
                  </td>
                  {(
                    [
                      ['canCreate', member.canCreate],
                      ['canUpdate', member.canUpdate],
                      ['canDelete', member.canDelete],
                      ['isAdmin', member.isAdmin],
                    ] as const
                  ).map(([field, value]) => (
                    <td key={field}>
                      <input
                        type="checkbox"
                        checked={value}
                        disabled={busy}
                        onChange={(event) =>
                          run(async () => {
                            if (!team) return;
                            await teamApi.updateMember(team.id, member.userId, {
                              [field]: event.target.checked,
                            });
                            await load(team.id);
                          })
                        }
                      />
                    </td>
                  ))}
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.buttonSm} ${styles.buttonDanger}`}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          if (!team) return;
                          await teamApi.removeMember(team.id, member.userId);
                          await load(team.id);
                        })
                      }
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
