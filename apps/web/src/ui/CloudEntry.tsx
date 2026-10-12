import { useAuth } from '../lib/auth';
import { navigate } from '../lib/router';
import styles from './common.module.scss';

/**
 * 首页（`/`）的云端入口。
 *
 * 根路径渲染的是 `LocalWhiteboard`——整页只有一个画布，不渲染 `TopBar`，
 * 因此登录 / 文档中心 / 管理后台这些入口在首页一个都看不到，只能手敲地址，
 * 很容易让人以为云端功能不存在。这里补一个固定的悬浮入口把它们暴露出来。
 *
 * 位置选左下角：Drawnix 自带工具栏占用了左上(`.app-toolbar`)、中上(`.draw-toolbar`)、
 * 右上(`.zoom-toolbar`) 和右下(`.theme-toolbar`)，只剩左下是空的
 * （见 packages/drawnix/src/styles/index.scss 里各 toolbar 的 absolute 定位）。
 */
export function CloudEntry() {
  const { user, isAdmin, config, loading } = useAuth();

  // 加载中不渲染，避免登录态确定前闪一下；
  // config 为 null 说明后端不可达（纯静态部署），此时保持界面干净，不做误导性引导。
  if (loading || !config) return null;

  return (
    <div className={styles.cloudEntry}>
      <div className={styles.cloudEntryHead}>
        <span className={styles.cloudEntryDot} />
        <span className={styles.cloudEntryTitle}>{config.siteName || '在线文档'}</span>
      </div>
      <p className={styles.cloudEntryHint}>
        {user ? `已登录：${user.email}` : '登录后可将画板保存到云端，并支持分享协作'}
      </p>
      <div className={styles.cloudEntryActions}>
        {user ? (
          <>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary} ${styles.buttonSm}`}
              onClick={() => navigate('/documents')}
            >
              进入文档中心
            </button>
            {isAdmin ? (
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSm}`}
                onClick={() => navigate('/admin')}
              >
                管理后台
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary} ${styles.buttonSm}`}
            onClick={() => navigate('/login')}
          >
            登录 / 注册
          </button>
        )}
      </div>
    </div>
  );
}
