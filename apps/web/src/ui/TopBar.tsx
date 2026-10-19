import type { ReactNode } from 'react';
import { ApiError, authApi, documentApi, emptyContentFor, type DocumentType } from '../api';
import { navigate, useRoute } from '../lib/router';
import { useAuth } from '../lib/auth';
import { Dropdown, DropdownItem } from './Dropdown';
import styles from './common.module.scss';

/**
 * 全局统一顶栏：品牌 + 主导航 + 账号区。
 *
 * 所有页面共用（主页文档管理、本地白板、编辑器、管理后台）。
 * 导航做进顶栏本身，各页面直接 `<TopBar />` 即可保持一致；
 * 页面若有额外内容（如文档标题）可作为 children 传进来，插在导航之后。
 */
export function TopBar({ children }: { children?: ReactNode }) {
  const { user, isAdmin, logout, config } = useAuth();
  const route = useRoute();

  const navItem = (active: boolean) =>
    active ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem;

  /** 顶栏快捷新建：已登录直接建云端文档，未登录进试用模式 */
  const quickCreate = async (type: DocumentType) => {
    if (!user) {
      navigate(`/try/${type}`);
      return;
    }
    try {
      const data = await documentApi.create({
        type,
        title: '未命名文档',
        content: emptyContentFor(type),
      });
      navigate(`/d/${data.document.id}`);
    } catch (error) {
      window.alert(error instanceof ApiError ? error.message : '创建文档失败');
    }
  };

  return (
    <div className={styles.topbar}>
      <span className={styles.brand} onClick={() => navigate(user ? '/documents' : '/')}>
        {config?.siteName ?? 'OpenDocs'}
      </span>

      <nav className={styles.nav}>
        <button
          type="button"
          className={navItem(route.kind === 'documents')}
          onClick={() => navigate('/documents')}
        >
          文档管理
        </button>
        <button
          type="button"
          className={navItem(route.kind === 'local')}
          onClick={() => navigate('/local')}
        >
          思维导图
        </button>
        <button type="button" className={styles.navItem} onClick={() => quickCreate('word')}>
          Word
        </button>
        <button type="button" className={styles.navItem} onClick={() => quickCreate('excel')}>
          Excel
        </button>
        <button type="button" className={styles.navItem} onClick={() => quickCreate('markdown')}>
          Markdown
        </button>
        <button type="button" className={styles.navItem} onClick={() => navigate('/image')}>
          图片编辑
        </button>
      </nav>

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
