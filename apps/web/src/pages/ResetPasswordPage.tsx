import { useState, type FormEvent } from 'react';
import { ApiError, authApi } from '../api';
import { navigate } from '../lib/router';
import styles from '../ui/common.module.scss';

export function ResetPasswordPage({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className={styles.authPage}>
        <div className={styles.authCard}>
          <h1 className={styles.authTitle}>链接无效</h1>
          <p className={styles.authSubtitle}>缺少重置密码令牌，请重新发起找回密码请求。</p>
          <button className={`${styles.button} ${styles.buttonBlock}`} onClick={() => navigate('/forgot-password')}>
            重新发起
          </button>
        </div>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.resetPassword({ token, newPassword: password });
      setDone(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '重置失败，链接可能已过期');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className={styles.authPage}>
        <div className={styles.authCard}>
          <h1 className={styles.authTitle}>密码已重置</h1>
          <p className={styles.authSubtitle}>新密码已生效，你已登录成功。</p>
          <button
            className={`${styles.button} ${styles.buttonPrimary} ${styles.buttonBlock}`}
            onClick={() => navigate('/documents')}
          >
            进入文档中心
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.authPage}>
      <div className={styles.authCard}>
        <h1 className={styles.authTitle}>设置新密码</h1>
        <form onSubmit={submit}>
          {error ? <div className={styles.error}>{error}</div> : null}
          <div className={styles.field}>
            <span className={styles.label}>新密码（至少 8 位）</span>
            <input
              className={styles.input}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className={`${styles.button} ${styles.buttonPrimary} ${styles.buttonBlock}`}
            disabled={busy}
          >
            {busy ? '提交中…' : '重置密码'}
          </button>
        </form>
      </div>
    </div>
  );
}
