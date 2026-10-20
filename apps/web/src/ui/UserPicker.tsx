import { useEffect, useMemo, useRef, useState } from 'react';
import { userApi, type PickableUser } from '../api';
import styles from './common.module.scss';

export interface UserPickerProps {
  placeholder?: string;
  /** 已存在的成员，避免重复添加 */
  excludeIds?: string[];
  onPick: (user: PickableUser) => void;
  disabled?: boolean;
}

/**
 * 站内用户选择器。
 *
 * 输入即筛选（防抖 250ms），下拉展示匹配用户；不输入时给最近注册的几个人，
 * 避免冷启动空白。只返回 id / 邮箱 / 昵称，不暴露角色等管理字段。
 */
export function UserPicker({ placeholder, excludeIds = [], onPick, disabled }: UserPickerProps) {
  const [keyword, setKeyword] = useState('');
  const [users, setUsers] = useState<PickableUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void userApi
        .search(keyword.trim())
        .then((data) => {
          if (!cancelled) setUsers(data.users);
        })
        .catch(() => {
          if (!cancelled) setUsers([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keyword]);

  // 点击外部收起下拉
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const visible = useMemo(
    () => users.filter((user) => !excludeIds.includes(user.id)),
    [users, excludeIds]
  );

  return (
    <div ref={boxRef} style={{ position: 'relative', flex: 1 }}>
      <input
        className={styles.input}
        style={{ width: '100%' }}
        placeholder={placeholder ?? '搜索站内用户（邮箱 / 昵称）'}
        value={keyword}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setKeyword(event.target.value);
          setOpen(true);
        }}
      />

      {open ? (
        <div
          className={styles.contextMenu}
          style={{ position: 'absolute', top: 34, left: 0, right: 0, zIndex: 1300, maxHeight: 220, overflow: 'auto' }}
        >
          {loading ? (
            <div className={styles.contextMenuItem}>搜索中…</div>
          ) : visible.length === 0 ? (
            <div className={styles.contextMenuItem}>没有匹配的用户</div>
          ) : (
            visible.map((user) => (
              <button
                key={user.id}
                type="button"
                className={styles.contextMenuItem}
                onClick={() => {
                  onPick(user);
                  setKeyword('');
                  setOpen(false);
                }}
              >
                <span style={{ display: 'block' }}>{user.displayName || user.email}</span>
                <span className={styles.hint}>{user.email}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
