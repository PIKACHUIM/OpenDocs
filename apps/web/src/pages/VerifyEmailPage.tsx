import { useEffect, useState } from 'react';
import { ApiError, authApi } from '../api';
import { navigate } from '../lib/router';
import styles from '../ui/common.module.scss';

export function VerifyEmailPage({ token }: { token: string }) {
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('缺少验证令牌');
      return;
    }
    let cancelled = false;
    void authApi
      .verifyEmail(token)
      .then(() => {
        if (!cancelled) setState('ok');
      })
      .catch((caught) => {
        if (!cancelled) {
          setState('error');
          setMessage(caught instanceof ApiError ? caught.message : '验证失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className={styles.authPage}>
      <div className={styles.authCard}>
        <h1 className={styles.authTitle}>邮箱验证</h1>
        {state === 'pending' ? <p className={styles.authSubtitle}>验证中…</p> : null}
        {state === 'ok' ? <div className={styles.success}>邮箱验证成功！</div> : null}
        {state === 'error' ? <div className={styles.error}>{message}</div> : null}
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
