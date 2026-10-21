import { alertDialog, confirmDialog } from '../../ui/dialog';
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  adminApi,
  type ApiTeam,
  type ApiTeamMember,
} from '../../api';
import { UserPicker } from '../../ui/UserPicker';
import styles from '../../ui/common.module.scss';

/**
 * 团队空间管理（管理后台的一个 tab）。
 *
 * 职责：
 * - 创建/删除团队空间，设置容量、上传开关、只读模式、默认成员权限、自动加入
 * - 管理成员与其权限（新建/修改/删除/管理员）
 * - 生成唯一的邀请令牌（相当于加入口令）
 */
export function TeamAdminPanel() {
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [members, setMembers] = useState<ApiTeamMember[]>([]);
  const [memberEmail, setMemberEmail] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.teams();
      setTeams(data.teams);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '团队空间加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (task: () => Promise<void>, success?: string) => {
    setBusy(true);
    try {
      await task();
      if (success) setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const loadMembers = async (teamId: string) => {
    const data = await adminApi.teamMembers(teamId);
    setMembers(data.members);
  };

  const patchTeam = (team: ApiTeam, patch: Partial<ApiTeam>) =>
    run(async () => {
      await adminApi.updateTeam(team.id, patch);
      await load();
    });

  /** 邀请令牌就是「加入口令」：成员在文档管理页的「加入团队」里粘贴 */
  const copyToken = (token: string) =>
    navigator.clipboard?.writeText(token).catch(() => undefined);

  return (
    <div>
      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.listWrap} style={{ padding: 16, marginBottom: 16 }}>
        <div className={styles.row} style={{ gap: 8 }}>
          <input
            className={styles.input}
            placeholder="新团队空间名称"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={busy || !newName.trim()}
            onClick={() =>
              run(async () => {
                await adminApi.createTeam({ name: newName.trim() });
                setNewName('');
                await load();
              })
            }
          >
            创建团队空间
          </button>
        </div>
        <p className={styles.hint} style={{ marginTop: 8 }}>
          管理员创建后，可在「成员」里添加用户，或生成邀请链接让成员自行加入。
        </p>
      </div>

      {loading ? (
        <div className={styles.center}>加载中…</div>
      ) : teams.length === 0 ? (
        <div className={styles.empty}>还没有团队空间</div>
      ) : (
        teams.map((team) => {
          const expanded = activeId === team.id;
          return (
            <div key={team.id} className={styles.listWrap} style={{ padding: 16, marginBottom: 12 }}>
              <div className={styles.row} style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{team.name}</div>
                  <div className={styles.hint} style={{ marginTop: 4 }}>
                    {team.memberCount ?? 0} 位成员 · {team.documentCount ?? 0} 个文档 · 已用{' '}
                    {((team.usedBytes ?? 0) / 1024 / 1024).toFixed(1)} MB
                    {team.readonly ? ' · 只读模式' : ''}
                  </div>
                </div>
                <div className={styles.row} style={{ gap: 6 }}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonSm}`}
                    onClick={() => {
                      setActiveId(expanded ? null : team.id);
                      setMemberEmail('');
                      if (!expanded) void loadMembers(team.id);
                    }}
                  >
                    {expanded ? '收起成员' : '成员'}
                  </button>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonSm}`}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const data = await adminApi.rotateTeamInvite(team.id);
                        void copyToken(data.inviteToken);
                        await alertDialog(
                          `邀请令牌已生成并复制：\n${data.inviteToken}\n\n成员在「文档管理 → 加入团队」里粘贴即可。`,
                          { title: '邀请令牌' }
                        );
                        await load();
                      })
                    }
                  >
                    {team.inviteEnabled ? '重置邀请链接' : '生成邀请链接'}
                  </button>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.buttonSm} ${styles.buttonDanger}`}
                    disabled={busy}
                    onClick={() => {
                      void confirmDialog(
                        `删除团队空间「${team.name}」？其中的文档会退回个人空间。`,
                        { danger: true, title: '删除团队空间', confirmText: '删除' }
                      ).then((ok) => {
                        if (!ok) return;
                        void run(async () => {
                          await adminApi.deleteTeam(team.id);
                          await load();
                        });
                      });
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>

              {team.inviteEnabled ? (
                <div className={styles.hint} style={{ marginTop: 8 }}>
                  已生成邀请令牌（出于安全考虑不再回显，点「重置邀请链接」可复制新令牌；重置后旧令牌立即失效）
                </div>
              ) : null}

              {/* 基础设置 */}
              <div className={styles.grid} style={{ marginTop: 12 }}>
                <label className={styles.field}>
                  <span className={styles.label}>容量上限（MB，0 为不限）</span>
                  <input
                    className={styles.input}
                    type="number"
                    min={0}
                    defaultValue={Math.round(team.quotaBytes / 1024 / 1024)}
                    onBlur={(event) =>
                      patchTeam(team, {
                        quotaBytes: (Number(event.target.value) || 0) * 1024 * 1024,
                      })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>单张图片上限（MB）</span>
                  <input
                    className={styles.input}
                    type="number"
                    min={0}
                    defaultValue={Math.round(team.maxImageBytes / 1024 / 1024)}
                    onBlur={(event) =>
                      patchTeam(team, {
                        maxImageBytes: (Number(event.target.value) || 0) * 1024 * 1024,
                      })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>单个文件上限（MB）</span>
                  <input
                    className={styles.input}
                    type="number"
                    min={0}
                    defaultValue={Math.round(team.maxFileBytes / 1024 / 1024)}
                    onBlur={(event) =>
                      patchTeam(team, {
                        maxFileBytes: (Number(event.target.value) || 0) * 1024 * 1024,
                      })
                    }
                  />
                </label>
              </div>

              <div className={styles.row} style={{ flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={team.allowImage}
                    onChange={(event) => void patchTeam(team, { allowImage: event.target.checked })}
                  />
                  允许上传图片
                </label>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={team.allowFile}
                    onChange={(event) => void patchTeam(team, { allowFile: event.target.checked })}
                  />
                  允许上传文件
                </label>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={team.readonly}
                    onChange={(event) => void patchTeam(team, { readonly: event.target.checked })}
                  />
                  只读模式（仅管理员可改）
                </label>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={team.autoJoin}
                    onChange={(event) => void patchTeam(team, { autoJoin: event.target.checked })}
                  />
                  新用户自动加入
                </label>
              </div>

              {/* 新成员默认权限 */}
              <div className={styles.row} style={{ flexWrap: 'wrap', gap: 16, marginTop: 10 }}>
                <span className={styles.hint}>新成员默认权限：</span>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={team.defaultCanCreate}
                    onChange={(event) =>
                      void patchTeam(team, { defaultCanCreate: event.target.checked })
                    }
                  />
                  新建
                </label>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={team.defaultCanUpdate}
                    onChange={(event) =>
                      void patchTeam(team, { defaultCanUpdate: event.target.checked })
                    }
                  />
                  修改
                </label>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={team.defaultCanDelete}
                    onChange={(event) =>
                      void patchTeam(team, { defaultCanDelete: event.target.checked })
                    }
                  />
                  删除
                </label>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={team.defaultIsAdmin}
                    onChange={(event) =>
                      void patchTeam(team, { defaultIsAdmin: event.target.checked })
                    }
                  />
                  管理员
                </label>
              </div>

              {/* 成员列表 */}
              {expanded ? (
                <div style={{ marginTop: 16 }}>
                  <div className={styles.row} style={{ gap: 8, marginBottom: 10 }}>
                    <UserPicker
                      placeholder="搜索站内用户（邮箱 / 昵称）"
                      excludeIds={members.map((member) => member.userId)}
                      disabled={busy}
                      onPick={(picked) =>
                        run(async () => {
                          await adminApi.addTeamMember(team.id, picked.email);
                          setMemberEmail('');
                          await loadMembers(team.id);
                          await load();
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
                                {member.displayName || member.email}
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
                                        await adminApi.updateTeamMember(team.id, member.userId, {
                                          [field]: event.target.checked,
                                        });
                                        await loadMembers(team.id);
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
                                      await adminApi.removeTeamMember(team.id, member.userId);
                                      await loadMembers(team.id);
                                      await load();
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
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
