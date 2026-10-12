import type { ReactNode } from 'react';
import { ApiError, authApi } from '../api';
import { navigate } from '../lib/router';
import { useAuth } from '../lib/auth';
import { Dropdown, DropdownItem } from './Dropdown';
import styles from './common.module.scss';

export function TopBar({ children }: { children?: ReactNode }) {
  const { user, isAdmin, logout, config } = useAuth();

  return (
    <div className={styles.topbar}>
      <span className={styles.brand} onClick={() => navigate('/documents')}>
        {config?.siteName ?? 'Drawnix'}
      </span>
      {children}
      <span className={styles.grow} />
      {user ? (
        <Dropdown
          trigger={
            <span className={styles.row} style={{ cursor: 'pointer' }}>
              <span className={styles.avatar}>{user.displayName.slice(0, 1).toUpperCase()}</span>
            </span>
          }
        >
          <div style={{ padding: '6px 10px 10px', borderBottom: '1px solid #e4e7ec', marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{user.displayName}</div>
            <div className={styles.hint}>{user.email}</div>
          </div>
          <DropdownItem onClick={() => navigate('/documents')}>我的文档</DropdownItem>
          {isAdmin ? <DropdownItem onClick={() => navigate('/admin')}>管理后台</DropdownItem> : null}
          <DropdownItem
            onClick={() => {
              void logout().then(() => navigate('/login'));
            }}
          >
            退出登录
          </DropdownItem>
        </Dropdown>
      ) : (
        <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => navigate('/login')}>
          登录
        </button>
      )}
    </div>
  );
}

export function VerifyEmailBanner() {
  const { user, refresh } = useAuth();
  if (!user || user.emailVerified) return null;

  const resend = async () => {
    try {
      await authApi.resendVerifyEmail();
      window.alert('验证邮件已重新发送，请查收');
    } catch (caught) {
      window.alert(caught instanceof ApiError ? caught.message : '发送失败');
    } finally {
      void refresh();
    }
  };

  return (
    <div
      style={{
        background: '#fff7e6',
        borderBottom: '1px solid #ffe1a8',
        color: '#8a5a00',
        fontSize: 13,
        padding: '8px 20px',
        display: 'flex',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <span>你的邮箱尚未验证，部分找回密码等功能依赖邮箱有效性。</span>
      <button className={`${styles.button} ${styles.buttonSm}`} onClick={resend}>
        重新发送验证邮件
      </button>
    </div>
  );
}
